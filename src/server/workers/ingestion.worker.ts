import { Worker, Job } from 'bullmq';
import path from 'path';
import fs from 'fs';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { EmailParserService } from '../services/gmail/emailParser.service';
import { DuplicateDetectorService } from '../services/gmail/duplicateDetector.service';
import { ClassificationAgent } from '../services/ai/classificationAgent';
import { GmailConnectorService } from '../services/gmail/gmailConnector.service';
import { AuditService } from '../services/audit.service';
import { processingQueue, QUEUE_NAMES } from '../queues/index';
import { nanoid } from 'nanoid';
import { findMergeCandidate } from '../services/claimMerge.service';
import type { IngestionJobData } from '../../shared/emailTypes';

const CLAIM_REF_REGEX = /CLM-\d{4}-[A-Z0-9]{4,6}/gi;

function extractClaimReferences(text: string): string[] {
  if (!text) return [];
  const matches = text.match(CLAIM_REF_REGEX);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.toUpperCase())));
}

const emailParser = new EmailParserService();
const duplicateDetector = new DuplicateDetectorService();
const classificationAgent = new ClassificationAgent();
const connectorService = new GmailConnectorService(prisma);
const auditService = new AuditService(prisma);

// Ensure upload directory exists
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function processIngestionJob(job: Job<IngestionJobData>) {
  const { connectorId, orgId, messageId, threadId } = job.data;

  logger.info({ messageId, connectorId }, 'Processing ingestion job');

  try {
    // Step 1: Fetch full connector and tokens
    const [connector, accessToken] = await Promise.all([
      connectorService.getConnectorById(connectorId),
      connectorService.getAccessToken(connectorId)
    ]);

    if (!connector) {
      throw new Error(`Connector not found for ID: ${connectorId}`);
    }

    const rawMessage = await fetchGmailMessage(accessToken, messageId);

    // Step 2: Parse email
    const email = emailParser.parseGmailMessage(rawMessage);

    // Step 3: Check for duplicates
    const dupCheck = await duplicateDetector.isDuplicate(prisma, email);
    if (dupCheck.duplicate) {
      logger.info({ messageId, reason: dupCheck.reason }, 'Duplicate email detected, skipping');
      await job.updateProgress(100);
      return { status: 'duplicate', reason: dupCheck.reason, existingClaimId: dupCheck.existingClaimId };
    }

    // Step 4: Store content hash for future dedup
    await duplicateDetector.storeContentHash(email);

    // Step 5: Classify email (applying connector filter rules)
    const filterRules = (connector.filterRules ?? []) as any[];
    const classification = await classificationAgent.classifyEmail(
      email,
      undefined, // use AI by default
      filterRules
    );

    // Step 6: If NOT_A_CLAIM, archive and skip
    if (classification.correspondenceType === 'NOT_A_CLAIM') {
      logger.info({ messageId }, 'Email classified as NOT_A_CLAIM, archiving');
      await auditService.logEvent({
        eventType: 'INGESTION',
        actorType: 'SYSTEM',
        action: 'ARCHIVE_NON_CLAIM',
        targetType: 'GMAIL_CONNECTOR',
        targetId: undefined, // targetId must be a Claim ID or undefined due to DB schema
        details: { connectorId, messageId, email: email.from.email, subject: email.subject }
      });
      return { status: 'archived', classification };
    }

    // Step 7: Ensure Claim exists and link Correspondence.
    //
    // Matching strategy (most reliable → least):
    //   1. Gmail thread ID — same conversation as a prior correspondence
    //   2. CLM-XXXX-XXXXX pattern in subject or body (with warning if it
    //      disagrees with the thread match)
    //   3. AI-classified existingClaimRef
    //   4. Subject-similarity merge candidate
    //   5. New claim
    let claimId: string;
    let wasMerged = false;
    const refsInSubject = extractClaimReferences(email.subject);
    const refsInBody = extractClaimReferences(email.bodyText);
    const extractedRefs = Array.from(new Set([...refsInSubject, ...refsInBody]));

    const threadMatch = email.threadId
      ? await prisma.claimCorrespondence.findFirst({
          where: { gmailThreadId: email.threadId },
          include: { claim: { select: { id: true, orgId: true, claimReference: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    if (threadMatch && threadMatch.claim.orgId === orgId) {
      claimId = threadMatch.claim.id;
      wasMerged = true;

      const activeRef = threadMatch.claim.claimReference.toUpperCase();
      const mismatched = extractedRefs.filter((r) => r !== activeRef);
      if (mismatched.length > 0) {
        logger.warn(
          {
            messageId,
            threadId: email.threadId,
            activeClaimRef: activeRef,
            quotedRefs: mismatched,
          },
          'Inbound email references a different claim ID than the thread — ignoring quoted refs, using thread match',
        );
        await auditService.logEvent({
          eventType: 'INGESTION',
          actorType: 'SYSTEM',
          action: 'CLAIM_REF_MISMATCH',
          targetType: 'CLAIM',
          targetId: claimId,
          details: {
            activeClaimRef: activeRef,
            quotedRefs: mismatched,
            source: 'thread_match_override',
            messageId,
          },
        });
      }

      logger.info({ claimId, messageId, threadId: email.threadId }, 'Matched inbound email to claim by thread ID');
    } else {
      // No thread match — try extracted claim references from subject/body strictly
      let resolvedByRef: { id: string; ref: string } | null = null;
      for (const ref of extractedRefs) {
        const existing = await findClaimByRef(orgId, ref);
        if (existing) {
          resolvedByRef = { id: existing.id, ref };
          break;
        }
      }

      if (resolvedByRef) {
        claimId = resolvedByRef.id;
        wasMerged = true;
        logger.info(
          { claimId, messageId, claimRef: resolvedByRef.ref },
          'Matched inbound email to claim by CLM-XXXX pattern in subject/body',
        );
      } else {
        // Strict routing: Do NOT fallback to AI hallucinated refs or subject similarity.
        // Create a new claim. If it's related, human review will catch it.
        claimId = await createInitialClaim(orgId, null, classification.priority, email);
      }
    }

    const correspondence = await prisma.claimCorrespondence.create({
      data: {
        claimId,
        direction: 'INBOUND',
        type: classification.correspondenceType,
        gmailMessageId: email.messageId,
        gmailThreadId: email.threadId,
        fromEmail: email.from.email,
        toEmail: email.to[0]?.email || '',
        subject: email.subject,
        body: email.bodyText.substring(0, 50000),
        attachments: email.attachments as any,
        sentAt: email.receivedAt,
      },
    });

    // Step 7b: Create audit trail for merged emails
    if (wasMerged) {
      await auditService.logEvent({
        eventType: 'CLAIM_MERGE',
        actorType: 'SYSTEM',
        action: 'Documents merged from additional email',
        targetType: 'CLAIM',
        targetId: claimId,
        details: {
          sourceEmailId: messageId,
          senderEmail: email.from.email,
          subject: email.subject,
          attachmentCount: email.attachments?.length ?? 0,
        },
      });
    }

    // Step 8: Download and save attachments
    if (email.attachments && email.attachments.length > 0) {
      for (const attachment of email.attachments) {
        try {
          if (!attachment.id) continue;

          logger.info({ messageId, filename: attachment.filename }, 'Downloading attachment');
          
          const buffer = await connectorService.getAttachmentData(
            connectorId,
            messageId,
            attachment.id
          );

          const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(attachment.filename)}`;
          const filePath = path.join(UPLOAD_DIR, uniqueName);
          
          fs.writeFileSync(filePath, buffer);

          await prisma.claimDocument.create({
            data: {
              claimId,
              fileKey: filePath,
              originalFilename: attachment.filename,
              mimeType: attachment.mimeType,
              fileSizeBytes: attachment.size,
              docType: attachment.filename.toLowerCase().includes('invoice') ? 'INVOICE' : 'CLAIM_FORM',
              processingStatus: 'pending'
            }
          });
        } catch (error: any) {
          logger.error({ messageId, filename: attachment.filename, error: error.message }, 'Failed to download attachment');
        }
      }
    }

    // Step 9: Queuing for further processing (OCR, extraction, etc.)
    // We do this AFTER attachments are saved so the processing worker finds the documents
    const queuePriority = classification.priority === 'urgent' ? 1 
                        : classification.priority === 'high' ? 2 
                        : 3;

    await processingQueue.add('process-claim', {
      claimId,
      orgId,
      correspondenceId: correspondence.id,
      emailMeta: {
        messageId: email.messageId,
        threadId: email.threadId,
        from: email.from,
        subject: email.subject,
        attachmentCount: email.attachments?.length ?? 0
      }
    }, {
      priority: queuePriority
    });

    // Step 10: Update connector sync
    await connectorService.updateLastSync(connectorId);

    logger.info(
      { messageId, type: classification.correspondenceType, priority: classification.priority },
      'Email ingested and queued for processing'
    );

    await auditService.logEvent({
      eventType: 'INGESTION',
      actorType: 'SYSTEM',
      action: 'INGEST_SUCCESS',
      targetType: 'CLAIM',
      targetId: claimId,
      details: { 
        messageId, 
        email: email.from.email, 
        type: classification.correspondenceType,
        connectorId
      }
    });

    return {
      status: 'ingested',
      classification,
      correspondenceId: correspondence.id,
    };
  } catch (error: any) {
    logger.error({ messageId, error: error.message }, 'Ingestion job failed');
    await auditService.logEvent({
      eventType: 'INGESTION',
      actorType: 'SYSTEM',
      action: 'INGEST_FAILED',
      targetType: 'GMAIL_CONNECTOR',
      targetId: undefined, // targetId must be a Claim ID or undefined due to DB schema
      details: { connectorId, messageId, error: error.message }
    });
    throw error;
  }
}

async function fetchGmailMessage(accessToken: string, messageId: string): Promise<any> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function findClaimByRef(orgId: string, claimRef: string) {
  return prisma.claim.findFirst({
    where: { orgId, claimReference: claimRef },
    select: { id: true },
  });
}

async function createInitialClaim(
  orgId: string, 
  claimReference: string | null, 
  priority: string,
  email: any
): Promise<string> {
  const finalRef = claimReference || `CLM-${new Date().getFullYear()}-${nanoid(5).toUpperCase()}`;
  
  const claim = await prisma.claim.create({
    data: {
      orgId,
      claimReference: finalRef,
      status: 'NEW',
      priority: priority === 'urgent' ? 100 : priority === 'high' ? 80 : 50,
      sourceEmailId: email.messageId,
      sourceThreadId: email.threadId,
    },
  });

  return claim.id;
}

export function startIngestionWorker() {
  const worker = new Worker<IngestionJobData>(QUEUE_NAMES.INGESTION, processIngestionJob, {
    connection: redis,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  });

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, status: result?.status }, 'Ingestion job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, 'Ingestion job failed');
  });

  logger.info('Ingestion worker started');
  return worker;
}
