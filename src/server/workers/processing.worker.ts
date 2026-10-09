import { Worker, Job } from 'bullmq';
import path from 'path';
import fs from 'fs';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { QUEUE_NAMES } from '../queues/index';
import { emitClaimProgress, emitClaimComplete } from '../socket/index';
import { nanoid } from 'nanoid';
import { processPdf } from '../services/pipelineOrchestrator';
import { ClaimJsonFormatterService } from '../services/claimJsonFormatter.service';
import { MemberValidationService } from '../services/memberValidation.service';
import { ProviderValidationService } from '../services/providerValidation.service';
import { CompletenessCheckService } from '../services/completenessCheck.service';
import { CoverageAnalysisService } from '../services/coverageAnalysis.service';
import { AdjudicationService, evaluateShouldHold } from '../services/adjudication.service';
import { EdiGeneratorService } from '../services/ediGenerator.service';
import { BupaClaimFormExtractorService } from '../services/bupaClaimFormExtractor.service';
import { BupaCorrespondenceService } from '../services/bupaCorrespondence.service';
import { DuplicateDetectionService } from '../services/duplicateDetection.service';
import { AuditService } from '../services/audit.service';
import { extractICDCodes } from '../services/icdCodingService';
import type { MemberValidationResult } from '../services/memberValidation.service';
import type { EligibilityResult } from '../services/memberValidation.service';
import type { ProviderValidationResult } from '../services/providerValidation.service';
import type { CompletenessResult, BupaClaimFormData } from '../services/completenessCheck.service';
import type { CoverageAnalysisResult, ClaimLineItem } from '../services/coverageAnalysis.service';
import type { AdjudicationResult } from '../services/adjudication.service';
import type { EdiOutput } from '../services/ediGenerator.service';

interface ProcessingJobData {
  claimId?: string;
  orgId: string;
  documentFileKeys?: string[];
  correspondenceId?: string;
  resumeFromStage?: string;
  classification?: {
    correspondenceType: string;
    priority: string;
  };
  emailMeta?: {
    messageId: string;
    threadId: string;
    from: { name: string; email: string };
    subject: string;
    attachmentCount: number;
  };
  // For manual upload (backward compat)
  fileName?: string;
  s3Key?: string;

  // Bupa-specific fields
  membershipNumber?: string;
  claimantName?: string;
  claimantDob?: string;
  facilityName?: string;
  practitionerName?: string;
  treatmentCountry?: string;
  treatmentDate?: string;
  treatmentType?: string;
  claimAmount?: number;
  currency?: string;
}

interface BupaValidationResults {
  readonly memberValidationPassed: boolean;
  readonly eligibilityPassed: boolean;
  /** True when eligibility was actually checked (member found in DB). Distinguishes
   * "failed" from "not checked" so missing-member claims aren't hard-denied. */
  readonly eligibilityChecked: boolean;
  readonly coverageScore: number | null;
  readonly completenessScore: number | null;
  readonly shouldHold: boolean;
  readonly manualInterventionRequired: boolean;
  /** True when adjudication decided human review is needed. */
  readonly adjudicationRequiresHumanReview: boolean;
  /** True when duplicate detection short-circuited the pipeline. */
  readonly isDuplicate?: boolean;
  /** True when claim was held for missing per-treatment itemized charges. */
  readonly missingItemisedCharges?: boolean;
  /** True when claim was denied (e.g. no email available to request info). */
  readonly autoDenied?: boolean;
  /** The full adjudication result for notification purposes. */
  readonly adjudicationResult?: any;
  /** The full eligibility result for notification purposes. */
  readonly eligibilityResult?: any;
}

const bupaExtractor = new BupaClaimFormExtractorService();
const auditService = new AuditService(prisma);
const bupaCorrespondence = new BupaCorrespondenceService(prisma);
const duplicateDetectionService = new DuplicateDetectionService(prisma);
const claimJsonFormatter = new ClaimJsonFormatterService();

// Where output artifacts (EDI 837, generated JSON, generated PDF) are written
// to disk so the Documents tab can list them alongside source uploads.
const OUTPUT_DIR = path.join(process.cwd(), 'uploads', 'outputs');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Persist a generated artifact to disk and create a ClaimDocument row so it
 * appears in the claim's Documents tab. Idempotent on (claimId, fileKey) — a
 * subsequent call replaces the prior version.
 */
async function persistOutputDocument(params: {
  claimId: string;
  filename: string;
  mimeType: string;
  content: Buffer | string;
  docType?: 'CORRESPONDENCE' | 'CLAIM_FORM' | 'INVOICE' | 'UNKNOWN';
}): Promise<void> {
  const { claimId, filename, mimeType, content, docType } = params;
  try {
    const claimDir = path.join(OUTPUT_DIR, claimId);
    if (!fs.existsSync(claimDir)) {
      fs.mkdirSync(claimDir, { recursive: true });
    }
    const filePath = path.join(claimDir, filename);
    fs.writeFileSync(filePath, content);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);

    // Replace any prior generated copy so re-processing does not orphan rows.
    await prisma.claimDocument.deleteMany({
      where: { claimId, fileKey: filePath },
    });

    await prisma.claimDocument.create({
      data: {
        claimId,
        fileKey: filePath,
        originalFilename: filename,
        mimeType,
        fileSizeBytes: buf.byteLength,
        docType: (docType ?? 'CORRESPONDENCE') as any,
        processingStatus: 'generated',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ claimId, filename, error: message }, 'Failed to persist output document');
  }
}

async function processClaimJob(job: Job<ProcessingJobData>) {
  const { orgId, resumeFromStage } = job.data;
  const startTime = Date.now();

  // Stage-skipping logic for pipeline resume after query response
  const STAGE_ORDER = ['EXTRACTING', 'TRANSLATING', 'CODING', 'VALIDATING', 'COMPLETENESS_CHECK'];
  let stageReached = !resumeFromStage;
  const shouldSkip = (stage: string): boolean => {
    if (!resumeFromStage) return false;
    if (stageReached) return false;
    if (stage === resumeFromStage) {
      stageReached = true;
      return false;
    }
    return true;
  };

  logger.info(
    { jobId: job.id, orgId, resumeFromStage: resumeFromStage ?? 'none' },
    resumeFromStage ? `Resuming claim processing from ${resumeFromStage}` : 'Starting claim processing',
  );

  try {
    // Step 1: Create or find claim
    const claimId = job.data.claimId || await createClaim(job.data);

    await auditService.logEvent({
      eventType: 'CLAIM_PROCESS',
      actorType: 'SYSTEM',
      action: resumeFromStage ? 'RESUME_PROCESSING' : 'START_PROCESSING',
      targetType: 'CLAIM',
      targetId: claimId,
      details: { 
        jobId: job.id, 
        resumeFromStage,
        source: job.data.emailMeta ? {
          from: job.data.emailMeta.from.email,
          subject: job.data.emailMeta.subject,
          attachmentCount: job.data.emailMeta.attachmentCount
        } : 'Manual Upload'
      }
    });

    // Step 2: Update status → EXTRACTING
    if (!shouldSkip('EXTRACTING')) {
      await updateClaimStatus(claimId, 'EXTRACTING');
      emitClaimProgress(orgId, {
        claimId,
        step: 'extracting',
        progress: 10,
        message: 'Extracting document text...',
      });
      await job.updateProgress(10);

      // Step 3: Document extraction
      await extractDocuments(claimId, orgId);
      emitClaimProgress(orgId, {
        claimId,
        step: 'extracting',
        progress: 30,
        message: 'Document extraction complete',
      });
      await job.updateProgress(30);
    }

    // Step 4: Language detection & translation
    if (!shouldSkip('TRANSLATING')) {
      await updateClaimStatus(claimId, 'TRANSLATING');
      emitClaimProgress(orgId, {
        claimId,
        step: 'translating',
        progress: 40,
        message: 'Detecting language and translating...',
      });
      await detectAndTranslate(claimId);
      await job.updateProgress(50);
    }

    // Step 5: ICD-10 Coding
    if (!shouldSkip('CODING')) {
      await updateClaimStatus(claimId, 'CODING');
      emitClaimProgress(orgId, {
        claimId,
        step: 'coding',
        progress: 60,
        message: 'Extracting medical codes...',
      });
      await performMedicalCoding(claimId);
      await job.updateProgress(75);
    }

    // Step 6: Validation
    if (!shouldSkip('VALIDATING') && !shouldSkip('COMPLETENESS_CHECK')) {
      await updateClaimStatus(claimId, 'VALIDATING');
      emitClaimProgress(orgId, {
        claimId,
        step: 'validating',
        progress: 65,
        message: resumeFromStage ? 'Re-validating after response...' : 'Validating extracted data...',
      });
      await validateClaim(claimId);
      await job.updateProgress(65);
    }

    // Step 6b: Bupa claims pipeline validation
    const bupaResults = await runBupaValidation(claimId, job.data, orgId, job);
    await job.updateProgress(92);

    // Step 7: Compute confidence & decide next action
    const overallConfidence = await computeOverallConfidence(claimId, bupaResults);

    const processingTimeMs = Date.now() - startTime;
    await prisma.claim.update({
      where: { id: claimId },
      data: {
        overallConfidence,
        processingTimeMs,
      },
    });

    // Step 8: Determine outcome
    const currentClaim = await prisma.claim.findUnique({
      where: { id: claimId },
      select: { status: true }
    });

    // Wire adjudicator's HUMAN_REVIEW decision into manualInterventionRequired so
    // it is respected by the final status gate below.
    // IMPORTANT: only honour the adjudicator flag when eligibility was actually checked.
    // When eligibility was never run (member not in DB / validation error), the adjudicator
    // fallback firing is a signal about missing inputs, not a genuine review trigger \u2014
    // we fall back to the confidence-based decision in that case.
    const adjudicationRequiresReview =
      bupaResults.eligibilityChecked && (bupaResults.adjudicationRequiresHumanReview ?? false);
    const effectiveManualIntervention = bupaResults.manualInterventionRequired || adjudicationRequiresReview;

    // Hard block: if eligibility was explicitly checked and failed, the claim
    // must never resolve to COMPLETE \u2014 route to REVIEWING (human will decide deny/override).
    const eligibilityExplicitlyFailed = bupaResults.eligibilityChecked && !bupaResults.eligibilityPassed;

    let finalStatus: string;
    if (bupaResults.isDuplicate || currentClaim?.status === 'DUPLICATE') {
      // Duplicate short-circuit wins over every other branch — once a claim has
      // been flagged as a duplicate the pipeline must not re-route it to
      // REVIEWING/COMPLETE/ON_HOLD.
      finalStatus = 'DUPLICATE';
    } else if (bupaResults.autoDenied || currentClaim?.status === 'DENIED') {
      finalStatus = 'DENIED';
    } else if (effectiveManualIntervention) {
      finalStatus = 'REVIEWING';
    } else if (currentClaim?.status === 'ON_HOLD' || bupaResults.shouldHold) {
      finalStatus = 'ON_HOLD';
    } else if (eligibilityExplicitlyFailed) {
      // Eligibility checked and failed: route to human review so an adjudicator
      // can confirm denial. Auto-complete is not allowed.
      finalStatus = 'REVIEWING';
    } else if (overallConfidence >= 75) {
      finalStatus = 'COMPLETE';
    } else if (overallConfidence >= 50) {
      finalStatus = 'REVIEWING';
    } else {
      finalStatus = 'REVIEWING';
    }

    await updateClaimStatus(claimId, finalStatus as any);
    if (finalStatus === 'COMPLETE') {
      await prisma.claim.update({
        where: { id: claimId },
        data: { completedAt: new Date() },
      });
    }

    // ── Auto-correspondence for Denial or Hold ──
    try {
      if ((finalStatus === 'DENIED' || finalStatus === 'ON_HOLD') && job.data.orgId) {
        // Resolve recipient
        const inboundCorrespondence = await prisma.claimCorrespondence.findFirst({
          where: { claimId, direction: 'INBOUND' },
          orderBy: { createdAt: 'desc' }
        });

        const recipientEmail = 
          job.data.emailMeta?.from.email 
          ?? inboundCorrespondence?.fromEmail 
          ?? bupaResults.eligibilityResult?.member?.email 
          ?? (await prisma.claim.findUnique({ where: { id: claimId } }).then(c => (c?.claimant as any)?.email))
          ?? null;

        const recipientName = 
          job.data.emailMeta?.from.name 
          ?? (await prisma.claim.findUnique({ where: { id: claimId } }).then(c => (c?.claimant as any)?.name))
          ?? 'Valued Member';

        if (recipientEmail && !bupaResults.isDuplicate) {
          if (finalStatus === 'DENIED') {
            const denialReasons = bupaResults.adjudicationResult?.denialReasons 
              ?? (bupaResults.eligibilityResult?.reason ? [bupaResults.eligibilityResult.reason] : ['Criteria not met']);

            await bupaCorrespondence.sendAndRecord({
              claimId,
              claimReference: currentClaim?.status === 'NEW' ? 'New Claim' : (await prisma.claim.findUnique({ where: { id: claimId }, select: { claimReference: true } }))?.claimReference ?? 'Claim',
              correspondenceType: 'DENIAL_NOTIFICATION',
              recipientEmail,
              recipientName,
              recipientLanguage: 'en',
              denialReasons,
            });
            logger.info({ claimId, to: recipientEmail }, '✅ Automated denial notification sent');
          } else if (finalStatus === 'ON_HOLD' && !bupaResults.missingItemisedCharges) {
            // "ON_HOLD" notification (if not already handled by missing-info logic)
            // We use STATUS_UPDATE for general holds
            await bupaCorrespondence.sendAndRecord({
              claimId,
              claimReference: (await prisma.claim.findUnique({ where: { id: claimId }, select: { claimReference: true } }))?.claimReference ?? 'Claim',
              correspondenceType: 'STATUS_UPDATE',
              recipientEmail,
              recipientName,
              recipientLanguage: 'en',
            });
            logger.info({ claimId, to: recipientEmail }, '✅ Automated status update (ON_HOLD) sent');
          }
        }
      }
    } catch (notifyError) {
      logger.warn({ claimId, error: (notifyError as any).message }, 'Failed to send automated notification');
    }

    emitClaimComplete(orgId, { claimId, status: finalStatus, overallConfidence });
    await job.updateProgress(100);

    logger.info(
      { claimId, confidence: overallConfidence, status: finalStatus, timeMs: processingTimeMs },
      'Claim processing completed'
    );

    const actionName = finalStatus === 'DUPLICATE' ? 'PROCESS_DUPLICATE'
      : finalStatus === 'ON_HOLD' ? 'PROCESS_HELD'
      : finalStatus === 'COMPLETE' ? 'PROCESS_COMPLETE'
      : 'PROCESS_REVIEW';

    await auditService.logEvent({
      eventType: 'CLAIM_PROCESS',
      actorType: 'SYSTEM',
      action: actionName,
      targetType: 'CLAIM',
      targetId: claimId,
      details: { 
        status: finalStatus, 
        confidence: overallConfidence,
        timeMs: processingTimeMs
      }
    });

    return { claimId, status: finalStatus, overallConfidence, processingTimeMs };
  } catch (error: any) {
    logger.error({ jobId: job.id, error: error.message }, 'Claim processing failed');
    
    // We try to log failure if we can find the claimId
    const claimId = job.data.claimId || (error as any).claimId;
    if (claimId) {
      await auditService.logEvent({
        eventType: 'CLAIM_PROCESS',
        actorType: 'SYSTEM',
        action: 'PROCESS_FAILED',
        targetType: 'CLAIM',
        targetId: claimId,
        details: { error: error.message }
      });
    }

    if (job.data.claimId) {
      await prisma.claim.update({
        where: { id: job.data.claimId },
        data: { errors: { push: error.message } },
      }).catch(() => {});
    }
    throw error;
  }
}

async function createClaim(data: ProcessingJobData): Promise<string> {
  const year = new Date().getFullYear();
  const seq = nanoid(5).toUpperCase();
  const claimReference = `CLM-${year}-${seq}`;

  const claim = await prisma.claim.create({
    data: {
      orgId: data.orgId,
      claimReference,
      status: 'NEW',
      priority: data.classification?.priority === 'urgent' ? 100
        : data.classification?.priority === 'high' ? 80
        : 50,
      sourceEmailId: data.emailMeta?.messageId,
      sourceThreadId: data.emailMeta?.threadId,
    },
  });

  return claim.id;
}

async function updateClaimStatus(claimId: string, status: string) {
  await prisma.claim.update({
    where: { id: claimId },
    data: { status: status as any },
  });
}

async function extractDocuments(claimId: string, orgId: string) {
  // Mark as processing
  await updateClaimStatus(claimId, 'EXTRACTING');

  // Load current claim to preserve existing fields not present in this run
  const currentClaim = await prisma.claim.findUnique({
    where: { id: claimId },
    select: { 
      claimant: true, 
      financials: true, 
      treatment: true, 
      declaration: true, 
      incident: true,
      status: true
    }
  });

  // Note: We no longer delete codes here at the start. Instead, we append new codes 
  // during extraction and perform a deduplication pass at the end. This prevents 
  // codes from disappearing if a subsequent extraction run is partially unsuccessful
  // or if we skip already-extracted documents.

  const docs = await prisma.claimDocument.findMany({ where: { claimId } });

  for (const doc of docs) {
    try {
      emitClaimProgress(orgId, {
        claimId,
        step: 'extracting',
        progress: 20,
        message: `Processing document: ${doc.originalFilename}...`,
      });

      // Step 3: Document extraction
      // Skip if already extracted to save time and avoid empty overwrites, 
      // unless text is missing.
      if (doc.processingStatus === 'extracted' && doc.extractedText) {
        logger.info({ claimId, docId: doc.id }, 'Skipping already extracted document');
        // We still re-run form data extraction below because it might benefit from 
        // global context or email merges, but we use the existing text.
      } else {
        const result = await processPdf(doc.fileKey);

        // Save extraction results to document
        await prisma.claimDocument.update({
          where: { id: doc.id },
          data: {
            processingStatus: 'extracted',
            extractedText: result.extraction.fullText,
            language: result.languageDetection.specificLanguage || result.languageDetection.language,
            pageCount: result.extraction.totalPages,
            extractionConfidence: 0.8,
          },
        });
        
        // Refresh the doc object text for downstream Bupa extraction
        (doc as any).extractedText = result.extraction.fullText;

        // Save codes to claimCoding table
        if (result.reconciliation.finalCodes && result.reconciliation.finalCodes.length > 0) {
          for (const c of result.reconciliation.finalCodes) {
            await prisma.claimCoding.create({
              data: {
                claimId,
                code: c.code,
                codeType: 'ICD10',
                description: c.description || '',
                llmDescription: c.llmDescription || '',
                confidence: (c.confidence || 0) / 100,
                evidenceSource: c.evidenceSourceText || '',
                pageNumber: c.pageNumber,
                pathUsed: c.pathUsed,
                reasoning: c.reasoningSummary || '',
                isPrimary: false,
                isValidated: c.isValidated,
              },
            });
          }

          await auditService.logEvent({
            eventType: 'CLAIM_CODING',
            actorType: 'SYSTEM',
            action: 'CODES_EXTRACTED',
            targetType: 'CLAIM',
            targetId: claimId,
            details: {
              documentId: doc.id,
              codeCount: result.reconciliation.finalCodes.length,
              primaryCodes: result.reconciliation.finalCodes.slice(0, 3).map((c) => c.code),
            },
          });
        }
      }

      const currentText = doc.extractedText || '';
      if (!currentText) continue;

      // --- New: Extract Bupa Form Data ---
      if (doc.docType === 'CLAIM_FORM' || currentText.toLowerCase().includes('bupa')) {
        const formData = await bupaExtractor.extractFromText(currentText);

        const extractedUpdate: Record<string, unknown> = {};

        const hasClaimant =
          formData.patientDetails.membershipNumber ||
          formData.patientDetails.firstName ||
          formData.patientDetails.lastName ||
          formData.patientDetails.dateOfBirth ||
          formData.patientDetails.email ||
          formData.patientDetails.telephone;

        if (hasClaimant) {
          const composedName =
            `${formData.patientDetails.firstName ?? ''} ${formData.patientDetails.lastName ?? ''}`.trim() || null;
          extractedUpdate.claimant = {
            membershipNumber: formData.patientDetails.membershipNumber,
            name: composedName,
            firstName: formData.patientDetails.firstName,
            lastName: formData.patientDetails.lastName,
            dateOfBirth: formData.patientDetails.dateOfBirth,
            email: formData.patientDetails.email,
            phone: formData.patientDetails.telephone,
          };
        }

        const hasTreatment =
          formData.medicalDetails.treatmentType ||
          formData.medicalDetails.treatmentDate ||
          formData.medicalDetails.facilityName ||
          formData.medicalDetails.practitionerName ||
          formData.medicalDetails.treatmentCountry;

        if (hasTreatment) {
          extractedUpdate.treatment = {
            country: formData.medicalDetails.treatmentCountry,
            treatmentType: formData.medicalDetails.treatmentType,
            treatmentDate: formData.medicalDetails.treatmentDate,
            facilityName: formData.medicalDetails.facilityName,
            practitionerName: formData.medicalDetails.practitionerName,
          };
        }

        const extractedAmount = formData.medicalDetails.totalClaimedAmount;
        const extractedCurrency = formData.medicalDetails.invoiceCurrency;
        const extractedItemisedCharges = formData.medicalDetails.itemisedCharges;
        const hasFinancials =
          extractedAmount != null ||
          extractedCurrency != null ||
          extractedItemisedCharges != null;

        if (hasFinancials) {
          const itemisedChargesCopy = extractedItemisedCharges
            ? extractedItemisedCharges.map((c) => ({
                description: c.description,
                amount: c.amount,
              }))
            : [];
          const totalClaimed = extractedAmount ?? itemisedChargesCopy.reduce((s, c) => s + c.amount, 0);

          extractedUpdate.financials = {
            totalClaimed,
            currency: extractedCurrency ?? 'USD',
            totalPayable: totalClaimed,
            deductibleApplied: 0,
            coInsuranceApplied: 0,
            totalNetworkPenalty: 0,
            totalDenied: 0,
            itemisedCharges: itemisedChargesCopy,
          };
        }

        if (Object.keys(extractedUpdate).length > 0) {
          logger.info(
            {
              claimId,
              extractedFields: Object.keys(extractedUpdate),
              totalClaimed: extractedAmount,
              currency: extractedCurrency,
            },
            'Persisting extracted Bupa form data',
          );

          // Merge logic: fetch latest DB state and combine with new extraction
          // This prevents Document B's extraction from wiping out fields found in Document A.
          const latestClaim = await prisma.claim.findUnique({
            where: { id: claimId },
            select: { claimant: true, financials: true, treatment: true, declaration: true, incident: true }
          });

          const mergeFields = (existing: any, incoming: any) => {
            if (!incoming) return existing;
            const merged = { ...(existing || {}) };
            for (const key in incoming) {
              if (incoming[key] !== null && incoming[key] !== undefined && incoming[key] !== '') {
                merged[key] = incoming[key];
              }
            }
            return merged;
          };

          const finalUpdate: Record<string, any> = {};
          if (extractedUpdate.claimant) finalUpdate.claimant = mergeFields(latestClaim?.claimant, extractedUpdate.claimant);
          if (extractedUpdate.financials) finalUpdate.financials = mergeFields(latestClaim?.financials, extractedUpdate.financials);
          if (extractedUpdate.treatment) finalUpdate.treatment = mergeFields(latestClaim?.treatment, extractedUpdate.treatment);
          if (extractedUpdate.declaration) finalUpdate.declaration = mergeFields(latestClaim?.declaration, extractedUpdate.declaration);
          if (extractedUpdate.incident) finalUpdate.incident = mergeFields(latestClaim?.incident, extractedUpdate.incident);

          if (Object.keys(finalUpdate).length > 0) {
            await prisma.claim.update({
              where: { id: claimId },
              data: finalUpdate,
            });
          }

          if (hasFinancials) {
            await auditService.logEvent({
              eventType: 'CLAIM_EXTRACT',
              actorType: 'SYSTEM',
              action: 'FINANCIALS_EXTRACTED',
              targetType: 'CLAIM',
              targetId: claimId,
              details: {
                totalClaimed: extractedAmount,
                currency: extractedCurrency,
                documentId: doc.id,
              },
              newValue: extractedUpdate.financials,
            });
          }
        }

        if (formData.patientDetails.membershipNumber) {
          await auditService.logEvent({
            eventType: 'CLAIM_EXTRACT',
            actorType: 'SYSTEM',
            action: 'MEMBER_EXTRACTED',
            targetType: 'CLAIM',
            targetId: claimId,
            details: {
              membershipNumber: formData.patientDetails.membershipNumber,
              claimantName: `${formData.patientDetails.firstName ?? ''} ${formData.patientDetails.lastName ?? ''}`.trim(),
              confidence: 'high',
            },
          });
        }

        if (!hasFinancials) {
          await auditService.logEvent({
            eventType: 'CLAIM_EXTRACT',
            actorType: 'SYSTEM',
            action: 'FINANCIAL_EXTRACTION_EMPTY',
            targetType: 'CLAIM',
            targetId: claimId,
            details: {
              reason: 'No financial fields (amount, currency, or charges) found by AI extractor',
              documentId: doc.id,
              docType: doc.docType,
            },
          });
        }
      }
    } catch (docError: any) {
      logger.error({ docId: doc.id, error: docError.message }, 'Failed to process individual document');
    }
  }

  // Final Pass: Deduplicate codes to clean up after multiple document extractions
  await deduplicateClaimCodes(claimId);
}

/**
 * Perform a server-side deduplication of codes for a claim.
 * Keeps the instance with highest confidence for each unique code.
 */
async function deduplicateClaimCodes(claimId: string) {
  const codes = await prisma.claimCoding.findMany({
    where: { claimId, reviewerAction: null },
    orderBy: { confidence: 'desc' }
  });

  if (codes.length <= 1) return;

  const seen = new Set<string>();
  const toDelete: string[] = [];

  for (const c of codes) {
    const key = `${c.codeType}:${c.code.replace(/\./g, '').toUpperCase()}`;
    if (seen.has(key)) {
      toDelete.push(c.id);
    } else {
      seen.add(key);
    }
  }

  if (toDelete.length > 0) {
    await prisma.claimCoding.deleteMany({
      where: { id: { in: toDelete } }
    });
    logger.info({ claimId, deletedCount: toDelete.length }, 'Deduplicated clinical codes after merge');
  }
}

async function detectAndTranslate(claimId: string) {
  // Logic is now handled inside extractDocuments via pipelineOrchestrator
}

async function performMedicalCoding(claimId: string) {
  // Logic is now handled inside extractDocuments via pipelineOrchestrator
}

async function validateClaim(claimId: string) {
  // Placeholder for future phase
}

async function runBupaValidation(
  claimId: string,
  jobData: ProcessingJobData,
  orgId: string,
  job: Job<ProcessingJobData>,
): Promise<BupaValidationResults> {
  const defaultResults: BupaValidationResults = {
    memberValidationPassed: false,
    eligibilityPassed: false,
    eligibilityChecked: false,
    coverageScore: null,
    completenessScore: null,
    shouldHold: false,
    manualInterventionRequired: false,
    adjudicationRequiresHumanReview: false,
  };

  try {
    // Look up the claim to get extracted data and claim reference
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        coding: true,
        documents: true,
        correspondence: {
          where: { direction: 'INBOUND' },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!claim) {
      logger.warn({ claimId }, 'Bupa validation: claim not found, skipping');
      return defaultResults;
    }

    let memberValidationResult: MemberValidationResult | null = null;
    let eligibilityResult: EligibilityResult | null = null;
    let providerValidationResult: ProviderValidationResult | null = null;
    let completenessResult: CompletenessResult | null = null;
    let coverageResult: CoverageAnalysisResult | null = null;
    let adjudicationResult: AdjudicationResult | null = null;
    let ediOutput: EdiOutput | null = null;
    let manualInterventionRequired = false;

    const memberValidationService = new MemberValidationService(prisma);
    const providerValidationService = new ProviderValidationService(prisma);
    const completenessCheckService = new CompletenessCheckService();
    const coverageAnalysisService = new CoverageAnalysisService();
    const adjudicationService = new AdjudicationService();
    const ediGeneratorService = new EdiGeneratorService();

    // --- Step 1: Member validation & eligibility ---
    emitClaimProgress(orgId, {
      claimId,
      step: 'bupa-member-validation',
      progress: 70,
      message: 'Validating member eligibility...',
    });

    let augmentedClaimant = { ...(claim.claimant as Record<string, unknown> || {}) };
    let augmentedFinancials = { ...(claim.financials as Record<string, unknown> || {}) };
    let augmentedTreatment = { ...(claim.treatment as Record<string, unknown> || {}) };
    let augmentedDeclaration = { ...(claim.declaration as Record<string, unknown> || {}) };
    let augmentedThirdParty = { ...(claim.incident as Record<string, unknown> || {}) }; // Incident holds 3rd party in this schema
    let dataWasAugmented = false;

    // ── Post-ingestion email parsing step ──
    //
    // Parse structured Bupa form fields from inbound email bodies (including
    // reply emails received after an outbound missing-info request). Any data
    // surfaced here is merged into the augmented* records below, persisted
    // BEFORE the completeness check, and audited as EMAIL_DATA_EXTRACTED so
    // the pipeline has a visible record of what came from email vs the PDF.
    const fieldsFromEmail: string[] = [];
    if (claim.correspondence && claim.correspondence.length > 0) {
      const emailText = claim.correspondence.map(c => `[Subject: ${c.subject}]\n${c.body}`).join('\n\n');
      const emailExtracted = await bupaExtractor.extractFromText(emailText);

      const markAugmented = (label: string) => {
        dataWasAugmented = true;
        fieldsFromEmail.push(label);
      };

      // Merge Claimant Info
      if (!augmentedClaimant.membershipNumber && emailExtracted.patientDetails.membershipNumber) {
        augmentedClaimant.membershipNumber = emailExtracted.patientDetails.membershipNumber;
        markAugmented('claimant.membershipNumber');
      }
      if (!augmentedClaimant.name && !augmentedClaimant.fullName && (emailExtracted.patientDetails.firstName || emailExtracted.patientDetails.lastName)) {
        const merged = `${emailExtracted.patientDetails.firstName || ''} ${emailExtracted.patientDetails.lastName || ''}`.trim();
        augmentedClaimant.name = merged;
        if (emailExtracted.patientDetails.firstName) augmentedClaimant.firstName = emailExtracted.patientDetails.firstName;
        if (emailExtracted.patientDetails.lastName) augmentedClaimant.lastName = emailExtracted.patientDetails.lastName;
        markAugmented('claimant.name');
      }
      if (!augmentedClaimant.dateOfBirth && emailExtracted.patientDetails.dateOfBirth) {
        augmentedClaimant.dateOfBirth = emailExtracted.patientDetails.dateOfBirth;
        markAugmented('claimant.dateOfBirth');
      }
      if (!augmentedClaimant.email && emailExtracted.patientDetails.email) {
        augmentedClaimant.email = emailExtracted.patientDetails.email;
        markAugmented('claimant.email');
      }

      // Merge Treatment/Medical Info
      if (!augmentedTreatment.facilityName && emailExtracted.medicalDetails.facilityName) {
        augmentedTreatment.facilityName = emailExtracted.medicalDetails.facilityName;
        markAugmented('treatment.facilityName');
      }
      if (!augmentedTreatment.practitionerName && emailExtracted.medicalDetails.practitionerName) {
        augmentedTreatment.practitionerName = emailExtracted.medicalDetails.practitionerName;
        markAugmented('treatment.practitionerName');
      }
      if (!augmentedTreatment.treatmentDate && emailExtracted.medicalDetails.treatmentDate) {
        augmentedTreatment.treatmentDate = emailExtracted.medicalDetails.treatmentDate;
        markAugmented('treatment.treatmentDate');
      }
      if (!augmentedTreatment.treatmentType && emailExtracted.medicalDetails.treatmentType) {
        augmentedTreatment.treatmentType = emailExtracted.medicalDetails.treatmentType;
        markAugmented('treatment.treatmentType');
      }
      if (!augmentedTreatment.symptomStartDate && emailExtracted.medicalDetails.symptomStartDate) {
        augmentedTreatment.symptomStartDate = emailExtracted.medicalDetails.symptomStartDate;
        markAugmented('treatment.symptomStartDate');
      }
      if (!augmentedTreatment.reasonForTreatment && emailExtracted.medicalDetails.reasonForTreatment) {
        augmentedTreatment.reasonForTreatment = emailExtracted.medicalDetails.reasonForTreatment;
        markAugmented('treatment.reasonForTreatment');
      }
      if (!augmentedTreatment.treatmentDescription && emailExtracted.medicalDetails.treatmentDescription) {
        augmentedTreatment.treatmentDescription = emailExtracted.medicalDetails.treatmentDescription;
        markAugmented('treatment.treatmentDescription');
      }
      if (!augmentedTreatment.admissionDate && emailExtracted.medicalDetails.admissionDate) {
        augmentedTreatment.admissionDate = emailExtracted.medicalDetails.admissionDate;
        markAugmented('treatment.admissionDate');
      }
      if (!augmentedTreatment.dischargeDate && emailExtracted.medicalDetails.dischargeDate) {
        augmentedTreatment.dischargeDate = emailExtracted.medicalDetails.dischargeDate;
        markAugmented('treatment.dischargeDate');
      }
      if (!augmentedTreatment.surgeryDate && emailExtracted.medicalDetails.surgeryDate) {
        augmentedTreatment.surgeryDate = emailExtracted.medicalDetails.surgeryDate;
        markAugmented('treatment.surgeryDate');
      }

      // Merge Financials & Payment Details
      if (!augmentedFinancials.totalClaimed && emailExtracted.medicalDetails.totalClaimedAmount) {
        augmentedFinancials.totalClaimed = emailExtracted.medicalDetails.totalClaimedAmount;
        markAugmented('financials.totalClaimed');
      }
      if (!augmentedFinancials.currency && emailExtracted.medicalDetails.invoiceCurrency) {
        augmentedFinancials.currency = emailExtracted.medicalDetails.invoiceCurrency;
        markAugmented('financials.currency');
      }
      if (!augmentedFinancials.payeeType && emailExtracted.paymentDetails.payeeType) {
        augmentedFinancials.payeeType = emailExtracted.paymentDetails.payeeType;
        markAugmented('financials.payeeType');
      }
      if (!augmentedFinancials.bankName && emailExtracted.paymentDetails.bankName) {
        augmentedFinancials.bankName = emailExtracted.paymentDetails.bankName;
        markAugmented('financials.bankName');
      }
      if (!augmentedFinancials.accountHolderName && emailExtracted.paymentDetails.accountHolderName) {
        augmentedFinancials.accountHolderName = emailExtracted.paymentDetails.accountHolderName;
        markAugmented('financials.accountHolderName');
      }
      if (!augmentedFinancials.swiftCode && emailExtracted.paymentDetails.swiftCode) {
        augmentedFinancials.swiftCode = emailExtracted.paymentDetails.swiftCode;
        markAugmented('financials.swiftCode');
      }
      if (!augmentedFinancials.iban && emailExtracted.paymentDetails.iban) {
        augmentedFinancials.iban = emailExtracted.paymentDetails.iban;
        markAugmented('financials.iban');
      }
      if (!augmentedFinancials.accountNumber && emailExtracted.paymentDetails.accountNumber) {
        augmentedFinancials.accountNumber = emailExtracted.paymentDetails.accountNumber;
        markAugmented('financials.accountNumber');
      }
      if (!augmentedFinancials.sortCode && emailExtracted.paymentDetails.sortCode) {
        augmentedFinancials.sortCode = emailExtracted.paymentDetails.sortCode;
        markAugmented('financials.sortCode');
      }

      // Merge Address and other patient fields
      if (!augmentedClaimant.groupName && emailExtracted.patientDetails.groupName) {
        augmentedClaimant.groupName = emailExtracted.patientDetails.groupName;
        markAugmented('claimant.groupName');
      }
      if (!augmentedClaimant.title && emailExtracted.patientDetails.title) {
        augmentedClaimant.title = emailExtracted.patientDetails.title;
        markAugmented('claimant.title');
      }
      if (!augmentedClaimant.telephone && emailExtracted.patientDetails.telephone) {
        augmentedClaimant.telephone = emailExtracted.patientDetails.telephone;
        markAugmented('claimant.telephone');
      }
      if (emailExtracted.patientDetails.address) {
        const currentAddr = (augmentedClaimant.address as Record<string, unknown>) || {};
        let addrChanged = false;
        const newAddr = emailExtracted.patientDetails.address;
        
        if (!currentAddr.building && newAddr.building) { currentAddr.building = newAddr.building; addrChanged = true; }
        if (!currentAddr.street && newAddr.street) { currentAddr.street = newAddr.street; addrChanged = true; }
        if (!currentAddr.town && newAddr.town) { currentAddr.town = newAddr.town; addrChanged = true; }
        if (!currentAddr.areaCode && newAddr.areaCode) { currentAddr.areaCode = newAddr.areaCode; addrChanged = true; }
        if (!currentAddr.region && newAddr.region) { currentAddr.region = newAddr.region; addrChanged = true; }
        if (!currentAddr.country && newAddr.country) { currentAddr.country = newAddr.country; addrChanged = true; }
        
        if (addrChanged) {
          augmentedClaimant.address = currentAddr;
          markAugmented('claimant.address');
        }
      }

      // ── Clinical Coding from Email ──
      // If we extracted a diagnosis from the email and we have no codes or low 
      // confidence, trigger the ICD-10 engine on the email diagnosis text.
      const diagnosisForCoding = emailExtracted.medicalDetails.reasonForTreatment || 
                                emailExtracted.medicalDetails.treatmentDescription;
      
      const hasExistingCodes = (claim.coding ?? []).length > 0;
      
      if (diagnosisForCoding && !hasExistingCodes) {
        logger.info({ claimId }, 'Triggering ICD-10 coding from email-extracted diagnosis');
        try {
          const emailCoding = await extractICDCodes(
            diagnosisForCoding, 
            'direct', 
            emailText, 
            'English'
          );

          if (emailCoding.codes.length > 0) {
            for (const c of emailCoding.codes) {
              await prisma.claimCoding.create({
                data: {
                  claimId,
                  code: c.code,
                  codeType: 'ICD10',
                  description: c.description,
                  llmDescription: c.llmDescription,
                  confidence: c.confidence / 100,
                  evidenceSource: c.evidenceSourceText,
                  pathUsed: 'email_extraction',
                  reasoning: c.reasoningSummary,
                  isValidated: c.isValidated,
                  isPrimary: false
                }
              });
            }
            
            await auditService.logEvent({
              eventType: 'CLAIM_CODING',
              actorType: 'SYSTEM',
              action: 'EMAIL_CODES_EXTRACTED',
              targetType: 'CLAIM',
              targetId: claimId,
              details: {
                count: emailCoding.codes.length,
                diagnosisSource: diagnosisForCoding
              }
            });

            // Re-fetch coding for the rest of validation
            const updatedCoding = await prisma.claimCoding.findMany({ where: { claimId } });
            (claim as any).coding = updatedCoding;
          }
        } catch (err: any) {
          logger.error({ claimId, error: err.message }, 'Failed to extract ICD codes from email text');
        }
      }

      // Merge Declaration fields (stored in the top-level 'declaration' JSON field).
      // This allows us to track signature status and printer names for Bupa STP fulfillment.
      if (emailExtracted.declaration.signaturePresent !== null) {
        if (augmentedDeclaration.signaturePresent === undefined || augmentedDeclaration.signaturePresent === null) {
          augmentedDeclaration.signaturePresent = emailExtracted.declaration.signaturePresent;
          markAugmented('declaration.signaturePresent');
        }
      }
      if (emailExtracted.declaration.signatureDate) {
        if (!augmentedDeclaration.signatureDate) {
          augmentedDeclaration.signatureDate = emailExtracted.declaration.signatureDate;
          markAugmented('declaration.signatureDate');
        }
      }
      if (emailExtracted.declaration.printName) {
        if (!augmentedDeclaration.printName) {
          augmentedDeclaration.printName = emailExtracted.declaration.printName;
          markAugmented('declaration.printName');
        }
      }

      // Merge Third Party info
      if (emailExtracted.thirdParty.applicable !== null) {
        if (augmentedThirdParty.applicable === undefined || augmentedThirdParty.applicable === null) {
          augmentedThirdParty.applicable = emailExtracted.thirdParty.applicable;
          markAugmented('thirdParty.applicable');
        }
      }
      if (emailExtracted.thirdParty.name) {
        if (!augmentedThirdParty.name) {
          augmentedThirdParty.name = emailExtracted.thirdParty.name;
          markAugmented('thirdParty.name');
        }
      }
      if (emailExtracted.thirdParty.contact) {
        if (!augmentedThirdParty.contact) {
          augmentedThirdParty.contact = emailExtracted.thirdParty.contact;
          markAugmented('thirdParty.contact');
        }
      }

      // Audit the email parsing step so the pipeline exposes an explicit
      // EMAIL_DATA_EXTRACTED event distinguishing email-sourced fields from
      // PDF-sourced ones. This is the step that was previously missing.
      if (fieldsFromEmail.length > 0) {
        const inboundCount = claim.correspondence.filter((c) => c.direction === 'INBOUND').length;
        await auditService.logEvent({
          eventType: 'CLAIM_EXTRACT',
          actorType: 'SYSTEM',
          action: 'EMAIL_DATA_EXTRACTED',
          targetType: 'CLAIM',
          targetId: claimId,
          details: {
            inboundEmailCount: inboundCount,
            fieldsResolved: fieldsFromEmail,
            resolvedFieldCount: fieldsFromEmail.length,
          },
        });
        logger.info(
          { claimId, fields: fieldsFromEmail },
          'Email-sourced fields merged into claim record',
        );
      }
    }

    // Effective values: prefer job data, then the augmented claim record (which now includes email data)
    const membershipNumber = jobData.membershipNumber || (augmentedClaimant?.membershipNumber as string | undefined);
    const claimantName = jobData.claimantName || (augmentedClaimant?.name as string | undefined) || (augmentedClaimant?.fullName as string | undefined);
    const claimantDob = jobData.claimantDob || (augmentedClaimant?.dateOfBirth as string | undefined);
    
    // Primary email from extracted form or manual entry; fallback to augmented claimant or source message sender
    let claimantEmail = jobData.emailMeta?.from.email || (augmentedClaimant?.email as string | undefined) || null;
    if (!claimantEmail && claim.correspondence && claim.correspondence.length > 0) {
      claimantEmail = claim.correspondence[0].fromEmail;
    }

    const facilityName = jobData.facilityName || (augmentedTreatment?.facilityName as string | undefined);
    const practitionerName = jobData.practitionerName || (augmentedTreatment?.practitionerName as string | undefined);
    const treatmentCountry = (jobData.treatmentCountry || (augmentedTreatment?.country as string | undefined)) ?? (augmentedFinancials?.treatmentCountry as string | undefined);
    const treatmentType = jobData.treatmentType || (augmentedTreatment?.treatmentType as string | undefined);
    const treatmentDate = jobData.treatmentDate || (augmentedTreatment?.treatmentDate as string | undefined);
    const effectiveClaimAmount =
      jobData.claimAmount ?? (augmentedFinancials?.totalClaimed as number | undefined) ?? undefined;
    const effectiveCurrency =
      jobData.currency ?? (augmentedFinancials?.currency as string | undefined) ?? undefined;
    const itemisedCharges =
      (augmentedFinancials?.itemisedCharges as { description: string; amount: number }[] | undefined) ?? null;

    // Fallback: If Reason for Treatment is missing globally but we have extracted coding data,
    // use the primary diagnosis description to satisfy the completeness check.
    // This allows STP (Straight Through Processing) to continue if clinical codes were extracted.
    if (!(augmentedTreatment?.reasonForTreatment) && claim.coding && claim.coding.length > 0) {
      const primaryCode = claim.coding.find(c => (c as any).isPrimary) || claim.coding[0];
      if (primaryCode && (primaryCode as any).description) {
        if (!augmentedTreatment) augmentedTreatment = {};
        augmentedTreatment.reasonForTreatment = (primaryCode as any).description;
        dataWasAugmented = true;
        logger.info({ claimId }, 'Automatically populated Reason for Treatment from clinical codes');
      }
    }

    // Split name for fuzzy lookup if needed
    const nameParts = claimantName?.trim().split(/\s+/) ?? [];
    const firstName = nameParts[0] ?? undefined;
    const lastName = nameParts.slice(1).join(' ') || undefined;

    const hasIdentificationData = membershipNumber || (firstName && lastName && claimantDob);

    if (hasIdentificationData) {
      try {
        memberValidationResult = await memberValidationService.validateMember({
          membershipNumber: membershipNumber,
          firstName,
          lastName,
          dateOfBirth: claimantDob,
        });

        if (memberValidationResult.isValid && memberValidationResult.member) {
          const treatmentDateInput = treatmentDate || new Date().toISOString().slice(0, 10);
          const treatmentCountryInput = treatmentCountry || 'GB';

          eligibilityResult = await memberValidationService.checkEligibility(
            memberValidationResult.member.id,
            {
              treatmentDate: treatmentDateInput,
              treatmentCountry: treatmentCountryInput,
              treatmentType,
              claimAmount: effectiveClaimAmount,
            },
          );
        }

        logger.info(
          { claimId, memberValid: memberValidationResult.isValid, eligible: eligibilityResult?.isEligible },
          'Bupa member validation complete',
        );

        await auditService.logEvent({
          eventType: 'CLAIM_VALIDATE',
          actorType: 'SYSTEM',
          action: memberValidationResult.isValid ? 'MEMBER_VALIDATED' : 'MEMBER_VALIDATION_FAILED',
          targetType: 'CLAIM',
          targetId: claimId,
          details: { 
            membershipNumber: membershipNumber ?? 'N/A (Fuzzy match used)',
            claimantName: claimantName ?? 'N/A',
            isValid: memberValidationResult.isValid,
            memberId: memberValidationResult.member?.id,
            isEligible: eligibilityResult?.isEligible,
            eligibilityReason: eligibilityResult?.reason,
            checks: memberValidationResult.checks
          }
        });
      } catch (memberError: unknown) {
        const message = memberError instanceof Error ? memberError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Bupa member validation failed, continuing pipeline');
        
        await auditService.logEvent({
          eventType: 'CLAIM_VALIDATE',
          actorType: 'SYSTEM',
          action: 'VALIDATION_ERROR',
          targetType: 'CLAIM',
          targetId: claimId,
          details: { error: message, stage: 'member_validation' }
        });
      }
    } else {
      // Audit EXACTLY what is missing to help user diagnose seed issues
      const missingFields = [];
      if (!membershipNumber) missingFields.push('membershipNumber');
      if (!firstName || !lastName) missingFields.push('claimantName');
      if (!claimantDob) missingFields.push('claimantDob');

      await auditService.logEvent({
        eventType: 'CLAIM_VALIDATE',
        actorType: 'SYSTEM',
        action: 'MEMBER_IDENTIFICATION_SKIPPED',
        targetType: 'CLAIM',
        targetId: claimId,
        details: { 
          reason: 'Insufficient identification data for lookup',
          missingFields,
          recommendation: 'Ensure claim form contains either a Membership Number or full Name and Date of Birth'
        }
      });
    }

    // --- Step 2: Provider validation ---
    emitClaimProgress(orgId, {
      claimId,
      step: 'bupa-provider-validation',
      progress: 75,
      message: 'Checking provider network...',
    });

    if (facilityName || practitionerName) {
      try {
        const planTier = memberValidationResult?.member?.planTier ?? 'SELECT';
        providerValidationResult = await providerValidationService.validateProvider(
          {
            facilityName,
            practitionerName,
            address: treatmentCountry ? { country: treatmentCountry } : undefined,
          },
          planTier,
        );

        logger.info(
          { claimId, providerValid: providerValidationResult.isValid, isNewProvider: providerValidationResult.isNewProvider },
          'Bupa provider validation complete',
        );
      } catch (providerError: unknown) {
        const message = providerError instanceof Error ? providerError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Bupa provider validation failed, continuing pipeline');
      }
    }

    // --- Step 2b: Persist any augmented data before completeness check ---
    if (dataWasAugmented) {
      await prisma.claim.update({
        where: { id: claimId },
        data: {
          claimant: augmentedClaimant as any,
          financials: augmentedFinancials as any,
          treatment: augmentedTreatment as any,
          declaration: augmentedDeclaration as any,
          incident: augmentedThirdParty as any
        },
      });

      logger.info({ claimId }, 'Claim record persisted with augmented data details');
    }

    // --- Step 2c: Duplicate detection ---
    // Skip the rest of the pipeline entirely when the claim matches one we
    // already have. Tag the claim with status DUPLICATE, log a
    // DUPLICATE_DETECTED audit event, and return early so coverage/
    // adjudication never run on an already-known claim.
    try {
      const dupCheck = await duplicateDetectionService.checkDuplicates({
        membershipNumber,
        memberId: memberValidationResult?.member?.id,
        treatmentDate,
        claimAmount: effectiveClaimAmount,
        currency: effectiveCurrency,
        facilityName,
        sourceThreadId: claim.sourceThreadId ?? undefined,
        excludeClaimId: claimId,
      });

      if (dupCheck.isDuplicate) {
        const matched = dupCheck.matchedClaims[0];

        await prisma.claim.update({
          where: { id: claimId },
          data: { status: 'DUPLICATE' as any },
        });

        await auditService.logEvent({
          eventType: 'CLAIM_STATUS',
          actorType: 'SYSTEM',
          action: 'DUPLICATE_DETECTED',
          targetType: 'CLAIM',
          targetId: claimId,
          details: {
            duplicateType: dupCheck.duplicateType,
            confidence: dupCheck.confidence,
            recommendation: dupCheck.recommendation,
            matchedClaimId: matched?.claimId,
            matchedClaimReference: matched?.claimReference,
            matchDetails: matched?.matchDetails,
            membershipNumber,
            treatmentDate,
            facilityName,
            claimAmount: effectiveClaimAmount,
          },
          previousValue: { status: claim.status },
          newValue: { status: 'DUPLICATE' },
        });

        emitClaimProgress(orgId, {
          claimId,
          step: 'duplicate-detected',
          progress: 100,
          message: `Claim flagged as duplicate of ${matched?.claimReference ?? 'an existing claim'}`,
        });

        logger.info(
          { claimId, duplicateType: dupCheck.duplicateType, matched: matched?.claimReference },
          'Duplicate claim detected — short-circuiting pipeline',
        );

        return {
          ...defaultResults,
          isDuplicate: true,
        };
      }
    } catch (dupError: unknown) {
      const message = dupError instanceof Error ? dupError.message : 'Unknown error';
      logger.warn({ claimId, error: message }, 'Duplicate detection failed, continuing pipeline');
    }

    // --- Step 3: Completeness check ---
    emitClaimProgress(orgId, {
      claimId,
      step: 'bupa-completeness',
      progress: 80,
      message: 'Analyzing coverage...',
    });

    try {
      const nameForForm = claimantName ?? '';
      const claimantAddress = (augmentedClaimant?.address as any) || null;

      const formData: BupaClaimFormData = {
        patientDetails: {
          membershipNumber: membershipNumber ?? null,
          groupName: (augmentedClaimant?.groupName as string) || null,
          title: (augmentedClaimant?.title as string) || null,
          firstName: nameForForm.split(' ')[0] || null,
          lastName: nameForForm.split(' ').slice(1).join(' ') || null,
          dateOfBirth: claimantDob ?? null,
          address: claimantAddress ? {
            building: claimantAddress.building || null,
            street: claimantAddress.street || null,
            town: claimantAddress.town || null,
            areaCode: claimantAddress.areaCode || null,
            region: claimantAddress.region || null,
            country: claimantAddress.country || null,
          } : null,
          email: claimantEmail,
          telephone: (augmentedClaimant?.telephone as string) || null,
        },
        medicalDetails: {
          treatmentCountry: treatmentCountry ?? null,
          invoiceCurrency: effectiveCurrency ?? null,
          totalClaimedAmount: effectiveClaimAmount ?? null,
          itemisedCharges,
          reasonForTreatment: (augmentedTreatment?.reasonForTreatment as string) || null,
          treatmentType: treatmentType ?? null,
          symptomStartDate: (augmentedTreatment?.symptomStartDate as string) || null,
          treatmentDate: treatmentDate ?? null,
          treatmentDescription: (augmentedTreatment?.treatmentDescription as string) || null,
          practitionerName: practitionerName ?? null,
          practitionerSpecialty: (augmentedTreatment?.practitionerSpecialty as string) || null,
          facilityName: facilityName ?? null,
          facilityAddress: (augmentedTreatment?.facilityAddress as string) || null,
          admissionDate: (augmentedTreatment?.admissionDate as string) || null,
          dischargeDate: (augmentedTreatment?.dischargeDate as string) || null,
          surgeryDate: (augmentedTreatment?.surgeryDate as string) || null,
          hospitalName: (augmentedTreatment?.hospitalName as string) || null,
        },
        cashBenefit: {
          applicable: null,
          hospitalStayFrom: null,
          hospitalStayTo: null,
          hospitalStampVerified: null,
        },
        paymentDetails: {
          payeeType: (augmentedFinancials?.payeeType as string) || null,
          bankName: (augmentedFinancials?.bankName as string) || null,
          swiftCode: (augmentedFinancials?.swiftCode as string) || null,
          accountNumber: (augmentedFinancials?.accountNumber as string) || null,
          sortCode: (augmentedFinancials?.sortCode as string) || null,
          iban: (augmentedFinancials?.iban as string) || null,
          accountHolderName: (augmentedFinancials?.accountHolderName as string) || null,
          accountCurrency: (augmentedFinancials?.accountCurrency as string) || null,
          chequeCurrencyPreference: (augmentedFinancials?.chequeCurrencyPreference as string) || null,
        },
        thirdParty: {
          applicable: (augmentedThirdParty?.applicable as boolean) ?? null,
          name: (augmentedThirdParty?.name as string) || null,
          contact: (augmentedThirdParty?.contact as string) || null,
        },
        consent: {
          consentGiven: null,
          reportViewPreference: null,
        },
        declaration: {
          signaturePresent: (augmentedDeclaration?.signaturePresent as boolean) ?? null,
          signatureDate: (augmentedDeclaration?.signatureDate as string) || null,
          printName: (augmentedDeclaration?.printName as string) || null,
        },
      };

      completenessResult = completenessCheckService.checkCompleteness(formData);

      // Always audit the completeness check result so the audit trail shows
      // the recomputed score after any email-sourced augmentation. Without
      // this, the UI only sees completeness events when the claim is held.
      await auditService.logEvent({
        eventType: 'CLAIM_VALIDATE',
        actorType: 'SYSTEM',
        action: 'COMPLETENESS_CHECKED',
        targetType: 'CLAIM',
        targetId: claimId,
        details: {
          score: completenessResult.score,
          recommendation: completenessResult.recommendation,
          canProcess: completenessResult.canProcess,
          criticalMissingCount: completenessResult.criticalMissing.length,
          criticalMissing: completenessResult.criticalMissing.map((f) => f.fieldPath),
          emailSourcedFields: fieldsFromEmail,
          rerunAfterAugmentation: dataWasAugmented,
        },
      });

      // --- Don't skip logic: If critical data (Financials or Coding) is missing from extraction ---
      const isMissingCriticalData = (completenessResult.criticalMissing.some(f => f.fieldPath.includes('totalClaimedAmount') || f.fieldPath.includes('invoiceCurrency'))) || (claim.coding.length === 0);
      
      if (isMissingCriticalData) {
        manualInterventionRequired = true;
        await auditService.logEvent({
          targetType: 'CLAIM',
          targetId: claimId,
          eventType: 'VALIDATION_CHECK',
          actorType: 'SYSTEM',
          action: 'MANUAL_INTERVENTION_REQUIRED',
          details: {
            status: 'WARNING',
            description: 'Automated extraction could not identify critical financial or coding data. Requesting human review of source documents.',
            missingCategories: claim.coding.length === 0 ? ['CODING', 'FINANCIAL'] : ['FINANCIAL'],
            recommendation: 'Please review the attachments and enter missing values manually.'
          }
        });
      }

      logger.info(
        { claimId, completenessScore: completenessResult.score, canProcess: completenessResult.canProcess },
        'Bupa completeness check complete',
      );

      // ── Step 3b: Auto-hold claim when critical info is missing ──
      if (completenessResult.criticalMissing.length > 0) {
        const { memberQuery, providerQuery } = completenessCheckService
          .generateMissingInfoQuery(completenessResult.missingFields);

        const missingFieldLabels = completenessResult.criticalMissing.map((f) => f.fieldLabel);
        const missingFieldPaths = completenessResult.criticalMissing.map((f) => f.fieldPath);

        try {
          await prisma.claim.update({
            where: { id: claimId },
            data: { status: 'ON_HOLD' },
          });

          await auditService.logEvent({
            eventType: 'CLAIM_STATUS',
            actorType: 'SYSTEM',
            action: 'CLAIM_ON_HOLD',
            targetType: 'CLAIM',
            targetId: claimId,
            details: {
              reason: 'Critical information missing from claim',
              completenessScore: completenessResult.score,
              recommendation: completenessResult.recommendation,
              criticalMissingFields: missingFieldPaths,
              missingFieldLabels,
              memberQueryCount: memberQuery.length,
              providerQueryCount: providerQuery.length,
            },
            previousValue: { status: claim.status },
            newValue: { status: 'ON_HOLD' },
          });

          emitClaimProgress(orgId, {
            claimId,
            step: 'bupa-on-hold',
            progress: 82,
            message: `Claim placed on hold — ${missingFieldLabels.length} critical field(s) missing`,
          });
        } catch (holdError: unknown) {
          const message = holdError instanceof Error ? holdError.message : 'Unknown error';
          logger.warn({ claimId, error: message }, 'Failed to set claim to ON_HOLD');
        }

        // Forward the on-hold notification to the member via correspondence
        if (memberQuery.length > 0 && claimantEmail) {
          try {
            const hasBankFields = memberQuery.some((f) => f.section === 'paymentDetails');
            const correspondenceType = hasBankFields ? 'BANK_DETAILS_REQUEST' : 'MISSING_INFO_REQUEST';

            await bupaCorrespondence.sendAndRecord({
              claimId,
              claimReference: claim.claimReference,
              correspondenceType,
              recipientEmail: claimantEmail,
              recipientName: claimantName ?? 'Member',
              recipientLanguage: 'en',
              membershipNumber: membershipNumber ?? undefined,
              treatmentDate: treatmentDate ?? undefined,
              facilityName: facilityName ?? undefined,
              claimAmount: effectiveClaimAmount ?? undefined,
              currency: effectiveCurrency ?? undefined,
              missingFields: memberQuery.map((f) => f.fieldLabel),
            });

            await auditService.logEvent({
              eventType: 'CLAIM_CORRESPONDENCE',
              actorType: 'SYSTEM',
              action: 'MISSING_INFO_REQUEST_SENT',
              targetType: 'CLAIM',
              targetId: claimId,
              details: {
                recipient: 'member',
                recipientEmail: claimantEmail,
                correspondenceType,
                missingFields: memberQuery.map((f) => f.fieldLabel),
              },
            });
          } catch (corrError: unknown) {
            const message = corrError instanceof Error ? corrError.message : 'Unknown error';
            logger.warn({ claimId, error: message }, 'Failed to send member missing-info correspondence');
          }
        } else if (memberQuery.length > 0) {
          await auditService.logEvent({
            eventType: 'CLAIM_CORRESPONDENCE',
            actorType: 'SYSTEM',
            action: 'MISSING_INFO_REQUEST_SKIPPED',
            targetType: 'CLAIM',
            targetId: claimId,
            details: {
              recipient: 'member',
              reason: 'No member email available to send missing-info request',
              missingFields: memberQuery.map((f) => f.fieldLabel),
            },
          });
        }

        // Forward to provider for clinical/medical missing fields.
        // ProviderRecord does not currently expose an email field; cast to
        // read the underlying DB property if present.
        const providerEmail = (providerValidationResult?.provider as { email?: string } | null | undefined)?.email ?? null;
        const providerName = providerValidationResult?.provider?.providerName ?? null;
        if (providerQuery.length > 0 && providerEmail) {
          try {
            await bupaCorrespondence.sendAndRecord({
              claimId,
              claimReference: claim.claimReference,
              correspondenceType: 'MEDICAL_QUERY',
              recipientEmail: providerEmail,
              recipientName: providerName ?? 'Provider',
              recipientLanguage: 'en',
              missingFields: providerQuery.map((f) => f.fieldLabel),
            });

            await auditService.logEvent({
              eventType: 'CLAIM_CORRESPONDENCE',
              actorType: 'SYSTEM',
              action: 'MEDICAL_QUERY_SENT',
              targetType: 'CLAIM',
              targetId: claimId,
              details: {
                recipient: 'provider',
                recipientEmail: providerEmail,
                missingFields: providerQuery.map((f) => f.fieldLabel),
              },
            });
          } catch (corrError: unknown) {
            const message = corrError instanceof Error ? corrError.message : 'Unknown error';
            logger.warn({ claimId, error: message }, 'Failed to send provider medical-query correspondence');
          }
        }

      }
    } catch (completenessError: unknown) {
      const message = completenessError instanceof Error ? completenessError.message : 'Unknown error';
      logger.warn({ claimId, error: message }, 'Bupa completeness check failed, continuing pipeline');
    }

    // --- Step 3c: Missing per-treatment itemized charges ---
    // Edge case: a claim that lists multiple treatments/procedures but only a
    // single total amount must NEVER be split equally across treatments — that
    // produces a meaningless coverage analysis. Instead, hold the claim and
    // request an itemised breakdown from whoever submitted it. If we have no
    // way to reach them at all, deny the claim.
    const treatmentDescription = (augmentedTreatment?.treatmentDescription as string | undefined) ?? '';
    const distinctTreatmentLines = treatmentDescription
      .split(/[;\n]/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const codingCount = claim.coding?.length ?? 0;
    const hasMultipleTreatments =
      codingCount >= 2 || distinctTreatmentLines.length >= 2;
    const itemizedCount = Array.isArray(itemisedCharges) ? itemisedCharges.length : 0;
    const hasItemisedBreakdown = itemizedCount >= 2;

    let missingItemisedCharges = false;
    let autoDenied = false;

    if (
      hasMultipleTreatments &&
      !hasItemisedBreakdown &&
      effectiveClaimAmount != null &&
      effectiveClaimAmount > 0
    ) {
      missingItemisedCharges = true;

      // Recipient resolution order (per spec):
      //   1. Original sender of the claim email (sourceEmailId / inbound correspondence)
      //   2. Member email from the validated member or extracted form data
      //   3. None — claim is denied with reason "No email found"
      const inboundCorrespondence = claim.correspondence?.find(
        (c) => c.direction === 'INBOUND',
      );
      const sourceEmail =
        inboundCorrespondence?.fromEmail
          ?? memberValidationResult?.member?.email
          ?? claimantEmail
          ?? null;

      if (sourceEmail) {
        try {
          await prisma.claim.update({
            where: { id: claimId },
            data: { status: 'ON_HOLD' as any },
          });

          await bupaCorrespondence.sendAndRecord({
            claimId,
            claimReference: claim.claimReference,
            correspondenceType: 'MISSING_INFO_REQUEST',
            recipientEmail: sourceEmail,
            recipientName: claimantName ?? 'Member',
            recipientLanguage: 'en',
            membershipNumber: membershipNumber ?? undefined,
            treatmentDate: treatmentDate ?? undefined,
            facilityName: facilityName ?? undefined,
            claimAmount: effectiveClaimAmount ?? undefined,
            currency: effectiveCurrency ?? undefined,
            missingFields: [
              'Itemised breakdown of charges per treatment / procedure (one line item with amount per treatment)',
            ],
          });

          await auditService.logEvent({
            eventType: 'CLAIM_STATUS',
            actorType: 'SYSTEM',
            action: 'CLAIM_ON_HOLD',
            targetType: 'CLAIM',
            targetId: claimId,
            details: {
              reason: 'Multiple treatments but no per-treatment itemised charges provided',
              treatmentCount: Math.max(codingCount, distinctTreatmentLines.length),
              totalAmount: effectiveClaimAmount,
              currency: effectiveCurrency,
              recipientEmail: sourceEmail,
              recipientSource: inboundCorrespondence
                ? 'inbound_email'
                : 'member_record',
            },
            previousValue: { status: claim.status },
            newValue: { status: 'ON_HOLD' },
          });

          logger.info(
            { claimId, recipient: sourceEmail },
            'Claim held — itemised breakdown requested via email',
          );
        } catch (itemError: unknown) {
          const message = itemError instanceof Error ? itemError.message : 'Unknown error';
          logger.warn(
            { claimId, error: message },
            'Failed to send itemised-breakdown request',
          );
        }
      } else {
        // No reply path at all — claim must be denied per spec.
        autoDenied = true;
        try {
          const denialFinancials = {
            ...(augmentedFinancials || {}),
            denialReason: 'No email found',
          };
          await prisma.claim.update({
            where: { id: claimId },
            data: {
              status: 'DENIED' as any,
              financials: denialFinancials as any,
            },
          });

          await auditService.logEvent({
            eventType: 'CLAIM_STATUS',
            actorType: 'SYSTEM',
            action: 'CLAIM_DENIED',
            targetType: 'CLAIM',
            targetId: claimId,
            details: {
              reason: 'No email found',
              underlyingIssue: 'Multiple treatments without itemised charges; no contact email available',
              treatmentCount: Math.max(codingCount, distinctTreatmentLines.length),
              totalAmount: effectiveClaimAmount,
              currency: effectiveCurrency,
            },
            previousValue: { status: claim.status },
            newValue: { status: 'DENIED' },
          });

          logger.info(
            { claimId },
            'Claim denied — no email available to request itemised breakdown',
          );
        } catch (denyError: unknown) {
          const message = denyError instanceof Error ? denyError.message : 'Unknown error';
          logger.warn(
            { claimId, error: message },
            'Failed to deny claim for missing itemised breakdown',
          );
        }
      }

      // Short-circuit the rest of the pipeline. We must NOT run coverage
      // analysis with auto-divided amounts; that's exactly the bug we're
      // fixing.
      return {
        ...defaultResults,
        completenessScore: completenessResult?.score ?? null,
        shouldHold: !autoDenied,
        missingItemisedCharges: true,
        autoDenied,
      };
    }

    // --- Step 4: Coverage analysis ---
    // Run coverage analysis when we have member data OR claim amount data.
    // Previously this required both member AND eligibility, which meant coverage
    // was entirely skipped when member lookup failed — tanking the confidence score.
    const hasMemberForCoverage = memberValidationResult?.member && eligibilityResult;
    const hasClaimDataForCoverage = (effectiveClaimAmount != null || (itemisedCharges && itemisedCharges.length > 0) || (claim.coding && claim.coding.length > 0));

    if (hasMemberForCoverage || hasClaimDataForCoverage) {
      try {
        const member = memberValidationResult?.member ?? null;
        const isOutOfNetwork = providerValidationResult?.networkAnalysis
          ? !providerValidationResult.networkAnalysis.isInNetwork
          : false;
        const networkPenaltyRate = providerValidationResult?.networkAnalysis?.coInsurancePenalty ?? 0;

        // --- Prioritize itemized charges from extraction over code-based distribution ---
        let finalLineItems: ClaimLineItem[] = [];

        if (itemisedCharges && itemisedCharges.length > 0) {
          // Priority 1: Use actual itemised charges from the extraction (e.g. Hospital stay, Surgery)
          // We assign the primary diagnosis code to each item so coverage rules still apply.
          logger.info({ claimId, itemCount: itemisedCharges.length }, 'Using itemised charges for coverage analysis');
          finalLineItems = itemisedCharges.map((item, idx) => ({
            index: idx,
            description: item.description,
            amount: item.amount,
            category: coverageAnalysisService.categorizeTreatment(
              item.description,
              claim.coding?.[0]?.code
            ),
            icdCode: claim.coding?.[0]?.code,
          }));
        } else if (effectiveClaimAmount) {
          // Priority 3: Final fallback to a single generic line item
          finalLineItems = [{
            index: 0,
            description: treatmentType ?? 'Medical treatment',
            amount: effectiveClaimAmount,
            category: coverageAnalysisService.categorizeTreatment(
              treatmentType ?? 'Medical treatment',
            ),
          }];
        }

        if (finalLineItems.length > 0) {
          coverageResult = coverageAnalysisService.analyzeCoverage({
            lineItems: finalLineItems,
            planTier: member?.planTier ?? 'SELECT',
            deductibleRemaining: eligibilityResult?.deductibleRemaining ?? 0,
            coInsuranceRate: eligibilityResult?.coInsuranceRate ?? 0,
            isOutOfNetwork,
            networkPenaltyRate,
            currency: effectiveCurrency ?? member?.deductible?.currency ?? 'USD',
            annualUsed: member?.deductible?.used ?? 0,
          });

          logger.info(
            { claimId, overallDecision: coverageResult.overallDecision, totalPayable: coverageResult.totalPayable },
            'Bupa coverage analysis complete',
          );

          await auditService.logEvent({
            eventType: 'CLAIM_COVERAGE',
            actorType: 'SYSTEM',
            action: 'COVERAGE_CALCULATED',
            targetType: 'CLAIM',
            targetId: claimId,
            details: { 
              decision: coverageResult.overallDecision,
              totalClaimed: coverageResult.totalClaimed,
              totalPayable: coverageResult.totalPayable,
              currency: coverageResult.annualMaximum.currency,
              exclusions: coverageResult.exclusionsTriggered.length,
              usedDefaults: !hasMemberForCoverage,
            }
          });
        }
      } catch (coverageError: unknown) {
        const message = coverageError instanceof Error ? coverageError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Bupa coverage analysis failed, continuing pipeline');

        await auditService.logEvent({
          eventType: 'CLAIM_COVERAGE',
          actorType: 'SYSTEM',
          action: 'COVERAGE_ERROR',
          targetType: 'CLAIM',
          targetId: claimId,
          details: { error: message }
        });
      }
    } else {
      // Root Cause #3: Coverage analysis skipped
      await auditService.logEvent({
        eventType: 'CLAIM_COVERAGE',
        actorType: 'SYSTEM',
        action: 'COVERAGE_SKIPPED',
        targetType: 'CLAIM',
        targetId: claimId,
        details: {
          reason: !memberValidationResult?.member ? 'Member not validated' : 'Eligibility check failed or skipped',
          memberFound: !!memberValidationResult?.member,
          eligibilityFound: !!eligibilityResult,
        }
      });
    }

    // --- Step 5: Adjudication ---
    emitClaimProgress(orgId, {
      claimId,
      step: 'bupa-adjudication',
      progress: 85,
      message: 'Running adjudication...',
    });

    // Pre-adjudication hold gate: waiting-period and pre-auth failures are
    // recoverable and must NOT flow into auto-deny. Park the claim on hold
    // and short-circuit before adjudication runs.
    const eligibilityFailedChecks = (eligibilityResult?.checks ?? [])
      .filter((c) => c.status === 'fail')
      .map((c) => c.name);

    const preAdjudicationHoldReason = eligibilityResult
      ? evaluateShouldHold({
          isEligible: eligibilityResult.isEligible,
          isChecked: true,
          preAuthRequired: eligibilityResult.preAuthRequired,
          reason: eligibilityResult.reason,
          failedChecks: eligibilityFailedChecks,
        })
      : null;

    if (preAdjudicationHoldReason !== null) {
      try {
        await prisma.claim.update({
          where: { id: claimId },
          data: { status: 'ON_HOLD' },
        });

        await auditService.logEvent({
          eventType: 'CLAIM_STATUS',
          actorType: 'SYSTEM',
          action: 'CLAIM_ON_HOLD',
          targetType: 'CLAIM',
          targetId: claimId,
          details: {
            reason: preAdjudicationHoldReason,
            stage: 'pre_adjudication',
            eligibilityReason: eligibilityResult?.reason,
            failedChecks: eligibilityFailedChecks,
            preAuthRequired: eligibilityResult?.preAuthRequired ?? false,
          },
          previousValue: { status: claim.status },
          newValue: { status: 'ON_HOLD' },
        });

        emitClaimProgress(orgId, {
          claimId,
          step: 'bupa-on-hold',
          progress: 85,
          message: `Claim placed on hold — ${preAdjudicationHoldReason}`,
        });

        logger.info(
          { claimId, holdReason: preAdjudicationHoldReason, failedChecks: eligibilityFailedChecks },
          'Claim placed on hold before adjudication',
        );
      } catch (holdError: unknown) {
        const message = holdError instanceof Error ? holdError.message : 'Unknown error';
        logger.warn(
          { claimId, error: message },
          'Failed to place claim on hold before adjudication',
        );
      }
    }

    if (preAdjudicationHoldReason === null) {
    try {
      const avgCodingConfidence = (claim.coding ?? []).length > 0
        ? (claim.coding ?? []).reduce((sum, c) => sum + c.confidence, 0) / (claim.coding ?? []).length * 100
        : 50;

      adjudicationResult = adjudicationService.adjudicate({
        claimReference: claim.claimReference,
        memberValidation: {
          isValid: memberValidationResult?.isValid ?? false,
          member: memberValidationResult?.member ?? null,
        },
        eligibility: {
          isEligible: eligibilityResult?.isEligible ?? false,
          isChecked: !!eligibilityResult,
          preAuthRequired: eligibilityResult?.preAuthRequired ?? false,
          reason: eligibilityResult?.reason ?? 'Eligibility not checked',
          failedChecks: (eligibilityResult?.checks ?? [])
            .filter((c) => c.status === 'fail')
            .map((c) => c.name),
        },
        providerValidation: {
          isValid: providerValidationResult?.isValid ?? true,
          provider: providerValidationResult?.provider ?? null,
          networkAnalysis: providerValidationResult?.networkAnalysis ?? null,
        },
        completeness: {
          score: completenessResult?.score ?? 50,
          isComplete: completenessResult?.isComplete ?? false,
          canProcess: completenessResult?.canProcess ?? true,
          criticalMissing: completenessResult?.criticalMissing ?? [],
        },
        codingConfidence: avgCodingConfidence,
        clinicalValidationScore: 85, // Default clinical validation score
        coverageAnalysis: {
          overallDecision: coverageResult?.overallDecision ?? 'NOT_COVERED',
          totalClaimed: coverageResult?.totalClaimed ?? effectiveClaimAmount ?? 0,
          totalPayable: coverageResult?.totalPayable ?? 0,
          totalDenied: coverageResult?.totalDenied ?? 0,
          exclusionsTriggered: coverageResult?.exclusionsTriggered ?? [],
        },
        isDuplicate: false,
        isComplaint: false,
        hasLegalCorrespondence: false,
        claimAmount: effectiveClaimAmount ?? coverageResult?.totalClaimed ?? 0,
        highValueThreshold: 50000,
      });

      logger.info(
        { claimId, decision: adjudicationResult.decision, payableAmount: adjudicationResult.payableAmount },
        'Bupa adjudication complete',
      );

      await auditService.logEvent({
        eventType: 'CLAIM_ADJUDICATE',
        actorType: 'SYSTEM',
        action: 'DECISION_MADE',
        targetType: 'CLAIM',
        targetId: claimId,
        details: { 
          decision: adjudicationResult.decision,
          payableAmount: adjudicationResult.payableAmount,
          reason: adjudicationResult.reason,
          requiresReview: adjudicationResult.requiresHumanReview,
          humanReviewReason: adjudicationResult.humanReviewReason
        }
      });
    } catch (adjError: unknown) {
      const message = adjError instanceof Error ? adjError.message : 'Unknown error';
      logger.warn({ claimId, error: message }, 'Bupa adjudication failed, continuing pipeline');

      await auditService.logEvent({
        eventType: 'CLAIM_ADJUDICATE',
        actorType: 'SYSTEM',
        action: 'ADJUDICATION_ERROR',
        targetType: 'CLAIM',
        targetId: claimId,
        details: { error: message }
      });
    }
    }

    // --- Step 6: EDI generation (if approved) ---
    emitClaimProgress(orgId, {
      claimId,
      step: 'bupa-edi',
      progress: 90,
      message: 'Generating EDI output...',
    });

    if (
      adjudicationResult &&
      (adjudicationResult.decision === 'APPROVED' || adjudicationResult.decision === 'PARTIALLY_APPROVED') &&
      memberValidationResult?.member
    ) {
      try {
        const member = memberValidationResult.member;
        const nameParts = member.fullName.split(' ');
        const firstName = nameParts[0] ?? '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const diagnoses = (claim.coding ?? []).map((code, idx) => ({
          code: code.code,
          isPrimary: idx === 0,
        }));

        const procedures = (claim.coding ?? []).map((code) => ({
          code: code.code,
          description: code.description || code.llmDescription || '',
          amount: coverageResult
            ? coverageResult.totalPayable / Math.max(1, (claim.coding ?? []).length)
            : effectiveClaimAmount ?? 0,
          serviceDate: treatmentDate ?? new Date().toISOString().slice(0, 10),
        }));

        ediOutput = ediGeneratorService.generate837P({
          claimReference: claim.claimReference,
          submitterName: 'Bupa Global',
          submitterIdentifier: 'BUPAGLOBAL',
          receiverName: 'Claims Processor',
          receiverIdentifier: 'CLAIMSPROC',
          member: {
            membershipNumber: member.membershipNumber,
            firstName,
            lastName,
            dateOfBirth: member.dateOfBirth,
            address: null,
          },
          provider: {
            providerName: providerValidationResult?.provider?.providerName ?? practitionerName ?? 'Unknown',
            facilityName: providerValidationResult?.provider?.facilityName ?? facilityName ?? 'Unknown',
            address: null,
          },
          claim: {
            totalAmount: adjudicationResult.payableAmount,
            currency: effectiveCurrency ?? 'USD',
            treatmentDate: treatmentDate ?? new Date().toISOString().slice(0, 10),
          },
          diagnoses: diagnoses.length > 0 ? diagnoses : [{ code: 'Z00.0', isPrimary: true }],
          procedures: procedures.length > 0 ? procedures : [{
            code: 'Z00.0',
            description: 'General examination',
            amount: adjudicationResult.payableAmount,
            serviceDate: treatmentDate ?? new Date().toISOString().slice(0, 10),
          }],
        });

        logger.info(
          { claimId, ediType: ediOutput.ediType, controlNumber: ediOutput.controlNumber },
          'Bupa EDI generation complete',
        );

        await auditService.logEvent({
          eventType: 'CLAIM_EDI',
          actorType: 'SYSTEM',
          action: 'EDI_GENERATED',
          targetType: 'CLAIM',
          targetId: claimId,
          details: { 
            ediType: ediOutput.ediType,
            controlNumber: ediOutput.controlNumber
          }
        });
      } catch (ediError: unknown) {
        const message = ediError instanceof Error ? ediError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Bupa EDI generation failed, continuing pipeline');

        await auditService.logEvent({
          eventType: 'CLAIM_EDI',
          actorType: 'SYSTEM',
          action: 'EDI_ERROR',
          targetType: 'CLAIM',
          targetId: claimId,
          details: { error: message }
        });
      }
    }

    // --- Step 7: Persist results to claim record ---
    try {
      const updateData: Record<string, unknown> = {};

      // Persist claimant (member info)
      if (memberValidationResult?.member) {
        const member = memberValidationResult.member;
        updateData.claimant = {
          membershipNumber: member.membershipNumber,
          name: member.fullName,
          fullName: member.fullName,
          dateOfBirth: member.dateOfBirth,
          email: member.email,
          phone: member.phone,
          planTier: member.planTier,
          planName: member.planName,
          policyStatus: member.policyStatus,
          validationChecks: memberValidationResult.checks,
        };
      } else if (augmentedClaimant && (augmentedClaimant.name || augmentedClaimant.fullName)) {
        // Member lookup didn't match, but we still have a name from PDF/email extraction.
        // Preserve it so the UI doesn't fall back to "Unnamed claimant".
        updateData.claimant = augmentedClaimant;
      }

      // Persist policy (plan info, deductible, co-insurance)
      if (memberValidationResult?.member) {
        const member = memberValidationResult.member;
        updateData.policy = {
          planTier: member.planTier,
          planName: member.planName,
          policyStartDate: member.policyStartDate,
          policyEndDate: member.policyEndDate,
          deductible: member.deductible,
          coInsuranceRate: member.coInsuranceRate,
          networkOption: member.networkOption,
          geographicCover: member.geographicCover,
          eligibility: eligibilityResult
            ? {
                isEligible: eligibilityResult.isEligible,
                reason: eligibilityResult.reason,
                preAuthRequired: eligibilityResult.preAuthRequired,
                checks: eligibilityResult.checks,
              }
            : null,
        };
      }

      // Persist coverage analysis
      if (coverageResult) {
        // Build the financials object as expected by the frontend
        updateData.financials = {
          totalClaimed: coverageResult.totalClaimed,
          totalPayable: coverageResult.totalPayable,
          totalDeductible: coverageResult.totalDeductible,
          deductibleApplied: coverageResult.totalDeductible,
          coInsuranceApplied: coverageResult.totalCoInsurance,
          totalNetworkPenalty: coverageResult.totalNetworkPenalty,
          totalDenied: coverageResult.totalDenied,
          currency: effectiveCurrency || 'USD',
          itemisedCharges: coverageResult.lineItemDecisions.map(d => ({
            description: d.description,
            amount: d.amountClaimed,
            payable: d.amountPayable,
            covered: d.isCovered,
            denyReason: d.denialReason
          }))
        };
        
        // Also keep coverageAnalysis for the coverage tab
        updateData.coverageAnalysis = {
          planTier: coverageResult.planTier,
          annualMaximum: coverageResult.annualMaximum,
          overallDecision: coverageResult.overallDecision,
          totalClaimed: coverageResult.totalClaimed,
          totalPayable: coverageResult.totalPayable,
          totalDeductible: coverageResult.totalDeductible,
          totalCoInsurance: coverageResult.totalCoInsurance,
          totalNetworkPenalty: coverageResult.totalNetworkPenalty,
          totalDenied: coverageResult.totalDenied,
          exclusionsTriggered: coverageResult.exclusionsTriggered,
          lineItemDecisions: coverageResult.lineItemDecisions,
        };
      } else if (effectiveClaimAmount != null || itemisedCharges != null) {
        // Root Cause #2: Always persist extracted financials even if coverage was skipped
        updateData.financials = {
          totalClaimed: effectiveClaimAmount ?? 0,
          currency: effectiveCurrency || 'USD',
          totalPayable: effectiveClaimAmount ?? 0,
          deductibleApplied: 0,
          coInsuranceApplied: 0,
          totalNetworkPenalty: 0,
          totalDenied: 0,
          itemisedCharges: itemisedCharges || [],
        };

        await auditService.logEvent({
          eventType: 'CLAIM_FINANCIALS',
          actorType: 'SYSTEM',
          action: 'FINANCIALS_PRESERVED',
          targetType: 'CLAIM',
          targetId: claimId,
          details: {
            reason: 'Coverage analysis skipped; preserving raw extracted financials',
            amount: effectiveClaimAmount,
            currency: effectiveCurrency
          }
        });
      }

      // Add adjudication details to financials if available
      if (adjudicationResult && updateData.financials) {
        const fin = updateData.financials as any;
        fin.decision = adjudicationResult.decision;
        fin.reason = adjudicationResult.reason;
        fin.adjudicatedBy = adjudicationResult.adjudicatedBy;
        fin.requiresHumanReview = adjudicationResult.requiresHumanReview;
        fin.humanReviewReason = adjudicationResult.humanReviewReason;
        fin.denialReasons = adjudicationResult.denialReasons;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.claim.update({
          where: { id: claimId },
          data: updateData,
        });

        logger.info({ claimId, updatedFields: Object.keys(updateData) }, 'Bupa validation results persisted to claim');
      }

      // Generate and persist the structured JSON output as a Document so it
      // appears on the Documents tab even if a user never hits the export
      // endpoint. This satisfies the rule: every claim must list every
      // input AND every produced output, including JSON, in the documents
      // section.
      try {
        const claimJsonOutput = claimJsonFormatter.formatClaimJson({
          claimReference: claim.claimReference,
          member: memberValidationResult?.member ?? null,
          provider: providerValidationResult?.provider ?? null,
          treatment: {
            country: treatmentCountry ?? 'Unknown',
            treatmentType: treatmentType ?? 'OUTPATIENT',
            primaryDiagnosis: claim.coding?.[0]
              ? { code: claim.coding[0].code, description: claim.coding[0].description }
              : null,
            procedures: [],
            medications: [],
          },
          financials: {
            currency: effectiveCurrency ?? 'USD',
            totalClaimed: effectiveClaimAmount ?? 0,
            deductibleApplied: coverageResult?.totalDeductible ?? 0,
            coInsuranceApplied: coverageResult?.totalCoInsurance ?? 0,
            networkPenalty: coverageResult?.totalNetworkPenalty ?? 0,
            totalPayable: coverageResult?.totalPayable ?? adjudicationResult?.payableAmount ?? 0,
            lineItems: coverageResult?.lineItemDecisions ?? [],
          },
          payment: null,
          decision: {
            status: adjudicationResult?.decision ?? 'PENDING',
            reason: adjudicationResult?.reason ?? 'Pending adjudication',
            adjudicatedBy: adjudicationResult?.adjudicatedBy ?? 'PENDING_HUMAN',
            adjudicatedAt: new Date().toISOString(),
            humanReviewRequired: adjudicationResult?.requiresHumanReview ?? false,
          },
          coding: {
            icd10: (claim.coding ?? []).map((c, i) => ({
              code: c.code,
              type: i === 0 ? 'PRIMARY' : 'SECONDARY',
              confidence: Math.round((c.confidence ?? 0) * 100),
              validated: c.isValidated ?? false,
            })),
            cpt: [],
          },
          coverageAnalysis: coverageResult ?? null,
          documents: [],
          auditTrail: [],
        } as any);

        await persistOutputDocument({
          claimId,
          filename: `${claim.claimReference}.output.json`,
          mimeType: 'application/json',
          content: JSON.stringify(claimJsonOutput, null, 2),
          docType: 'CORRESPONDENCE',
        });
      } catch (jsonError: unknown) {
        const message = jsonError instanceof Error ? jsonError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Failed to generate JSON output document');
      }
    } catch (persistError: unknown) {
      const message = persistError instanceof Error ? persistError.message : 'Unknown error';
      logger.warn({ claimId, error: message }, 'Failed to persist Bupa validation results, continuing pipeline');
    }

    // --- Step 8: Create MemberClaim link ---
    if (memberValidationResult?.member) {
      try {
        await prisma.memberClaim.upsert({
          where: {
            memberId_claimId: {
              memberId: memberValidationResult.member.id,
              claimId,
            },
          },
          update: {},
          create: {
            memberId: memberValidationResult.member.id,
            claimId,
          },
        });

        logger.info({ claimId, memberId: memberValidationResult.member.id }, 'MemberClaim link created');
      } catch (linkError: unknown) {
        const message = linkError instanceof Error ? linkError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Failed to create MemberClaim link, continuing pipeline');
      }
    }

    // --- Step 9: Create ProviderClaim link ---
    if (providerValidationResult?.provider) {
      try {
        await prisma.providerClaim.upsert({
          where: {
            providerId_claimId: {
              providerId: providerValidationResult.provider.id,
              claimId,
            },
          },
          update: {},
          create: {
            providerId: providerValidationResult.provider.id,
            claimId,
          },
        });

        logger.info({ claimId, providerId: providerValidationResult.provider.id }, 'ProviderClaim link created');
      } catch (linkError: unknown) {
        const message = linkError instanceof Error ? linkError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Failed to create ProviderClaim link, continuing pipeline');
      }
    }

    // --- Step 10: Create EdiTransaction record ---
    if (ediOutput) {
      try {
        // Supersede any prior UN-TRANSMITTED EDI transactions for this claim
        // so re-processing does not leave orphan GENERATED rows hanging
        // around. Anything already TRANSMITTED is left alone.
        await prisma.ediTransaction.deleteMany({
          where: { claimId, status: 'GENERATED' },
        });
        await prisma.ediTransaction.create({
          data: {
            claimId,
            ediType: ediOutput.ediType,
            ediContent: ediOutput.ediContent,
            controlNumber: ediOutput.controlNumber,
            status: 'GENERATED',
          },
        });

        // Surface the EDI as a downloadable document on the claim's
        // Documents tab so input + output documents live in one place.
        await persistOutputDocument({
          claimId,
          filename: `${claim.claimReference}.edi.txt`,
          mimeType: 'text/plain',
          content: ediOutput.ediContent,
          docType: 'CORRESPONDENCE',
        });

        logger.info({ claimId, controlNumber: ediOutput.controlNumber }, 'EdiTransaction record created');
      } catch (ediError: unknown) {
        const message = ediError instanceof Error ? ediError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Failed to create EdiTransaction record, continuing pipeline');
      }
    }

    // --- Step 11: Create CoverageDecision records ---
    if (coverageResult && coverageResult.lineItemDecisions.length > 0) {
      try {
        // Clear any stale coverage decisions from a prior run so re-processing
        // does not accumulate duplicates.
        await prisma.coverageDecision.deleteMany({ where: { claimId } });
        for (const decision of coverageResult.lineItemDecisions) {
          await prisma.coverageDecision.create({
            data: {
              claimId,
              lineItemIndex: decision.index,
              benefitName: decision.benefitCategory,
              isCovered: decision.isCovered,
              coverageLimit: decision.benefitLimit,
              amountClaimed: decision.amountClaimed,
              amountPayable: decision.amountPayable,
              deductibleApplied: decision.deductibleApplied,
              coInsuranceApplied: decision.coInsuranceApplied,
              networkPenalty: decision.networkPenalty,
              denialReason: decision.denialReason,
            },
          });
        }

        logger.info(
          { claimId, decisionCount: coverageResult.lineItemDecisions.length },
          'CoverageDecision records created',
        );
      } catch (decisionError: unknown) {
        const message = decisionError instanceof Error ? decisionError.message : 'Unknown error';
        logger.warn({ claimId, error: message }, 'Failed to create CoverageDecision records, continuing pipeline');
      }
    }

    const coverageScore = coverageResult
      ? (coverageResult.totalPayable / Math.max(1, coverageResult.totalClaimed)) * 100
      : null;

    return {
      ...defaultResults,
      memberValidationPassed: memberValidationResult?.isValid ?? false,
      eligibilityPassed: eligibilityResult?.isEligible ?? false,
      eligibilityChecked: !!eligibilityResult,
      coverageScore: (coverageResult?.overallDecision === 'FULLY_COVERED' || coverageResult?.overallDecision === 'PARTIALLY_COVERED') ? 100 : 50,
      completenessScore: completenessResult?.score ?? null,
      shouldHold: preAdjudicationHoldReason !== null || (completenessResult?.criticalMissing.length ?? 0) > 0,
      manualInterventionRequired,
      adjudicationRequiresHumanReview: adjudicationResult?.requiresHumanReview ?? false,
      adjudicationResult,
      eligibilityResult,
    };
  } catch (bupaError: unknown) {
    const message = bupaError instanceof Error ? bupaError.message : 'Unknown error';
    logger.warn({ claimId, error: message }, 'Bupa validation pipeline failed entirely, continuing with defaults');
    return defaultResults;
  }
}

/**
 * Compute a weighted overall confidence score for a claim on a 0–100 scale.
 *
 * Previously this function divided the weighted sum by 100 before returning,
 * producing a 0–1 fraction that (a) was displayed as "0.7%" / "0.9%" in the UI
 * and (b) never triggered the `>= 85` / `>= 60` branches in the worker, so every
 * claim was routed to REVIEWING. The scale is now a percentage (0–100) so that
 * both the UI and the worker branches behave correctly.
 */
async function computeOverallConfidence(claimId: string, bupaResults?: BupaValidationResults): Promise<number> {
  const codes = await prisma.claimCoding.findMany({ where: { claimId } });

  // Baseline sub-scores (0–100 scale)
  const DEFAULT_DOCUMENT_EXTRACTION = 88;
  const DEFAULT_TRANSLATION_ACCURACY = 90;
  const DEFAULT_DATA_COMPLETENESS = 80;
  const DEFAULT_IDENTITY_MATCH = 70;
  const DEFAULT_FINANCIAL_ACCURACY = 75;

  // ClaimCoding.confidence is stored as 0–1; convert to 0–100 here.
  const avgCodingConfidence = codes.length > 0
    ? (codes.reduce((sum, c) => sum + c.confidence, 0) / codes.length) * 100
    : 60; // No codes yet: moderate baseline so the claim can still progress

  const weights = {
    documentExtraction: 0.20,
    translationAccuracy: 0.15,
    dataCompleteness: 0.20,
    medicalCoding: 0.25,
    financialAccuracy: 0.10,
    identityMatch: 0.10,
  };

  // Factor in Bupa validation results when present
  let identityMatchScore = DEFAULT_IDENTITY_MATCH;
  let financialAccuracyScore = DEFAULT_FINANCIAL_ACCURACY;
  let dataCompletenessScore = DEFAULT_DATA_COMPLETENESS;
  
  if (bupaResults) {
    if (bupaResults.memberValidationPassed) {
      identityMatchScore = Math.min(100, identityMatchScore + 15);
    }
    if (bupaResults.eligibilityPassed) {
      identityMatchScore = 95;
    }
    if (bupaResults.coverageScore != null) {
      financialAccuracyScore = bupaResults.coverageScore;
    }
    if (bupaResults.completenessScore != null) {
      dataCompletenessScore = bupaResults.completenessScore;
    }
  }

  const overall =
    DEFAULT_DOCUMENT_EXTRACTION * weights.documentExtraction +
    DEFAULT_TRANSLATION_ACCURACY * weights.translationAccuracy +
    dataCompletenessScore * weights.dataCompleteness +
    avgCodingConfidence * weights.medicalCoding +
    financialAccuracyScore * weights.financialAccuracy +
    identityMatchScore * weights.identityMatch;

  // Clamp to [0, 100] and round to one decimal place
  const clamped = Math.max(0, Math.min(100, overall));
  return Math.round(clamped * 10) / 10;
}

export function startProcessingWorker() {
  const worker = new Worker<ProcessingJobData>(QUEUE_NAMES.PROCESSING, processClaimJob, {
    connection: redis,
    concurrency: 3,
  });

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, claimId: result?.claimId, status: result?.status }, 'Processing job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, 'Processing job failed');
  });

  logger.info('Processing worker started');
  return worker;
}

if (require.main === module) {
  const worker = startProcessingWorker();

  const shutdown = async () => {
    logger.info('Stopping processing worker');
    await worker.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
}
