import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { invokeBedrockModel } from './bedrockClient';
import { processingQueue } from '../queues';

// ─── Types ─────────────────────────────────────────

export interface IncomingEmailData {
  readonly fromEmail: string;
  readonly subject: string;
  readonly body: string;
  readonly threadId?: string;
  readonly attachments?: ReadonlyArray<{
    filename: string;
    content: string;
    mimeType: string;
  }>;
}

export interface ResponseProcessingResult {
  readonly matched: boolean;
  readonly claimId: string | null;
  readonly claimReference: string | null;
  readonly extractedFields: Record<string, string | number | null>;
  readonly fieldsResolved: string[];
  readonly fieldsStillMissing: string[];
  readonly pipelineResumed: boolean;
  readonly action:
    | 'FIELDS_EXTRACTED'
    | 'ATTACHMENT_PROCESSED'
    | 'NO_MATCH'
    | 'INSUFFICIENT_DATA';
}

// ─── Constants ─────────────────────────────────────

const QRY_REFERENCE_PATTERN = /\[QRY-([A-Za-z0-9-]+)-(\d+)\]/;
const OPEN_QUERY_STATUSES = ['SENT', 'AWAITING_RESPONSE'] as const;
const HOLD_STATUSES = ['ON_HOLD', 'QUERYING'] as const;

const CLAIMANT_FIELDS = new Set([
  'memberName',
  'membershipNumber',
  'dateOfBirth',
  'email',
  'phone',
  'address',
  'nationality',
  'policyNumber',
]);

const FINANCIAL_FIELDS = new Set([
  'bankName',
  'accountHolderName',
  'accountNumber',
  'iban',
  'sortCode',
  'swiftBic',
  'currency',
  'claimAmount',
  'invoiceNumber',
]);

const TREATMENT_FIELDS = new Set([
  'diagnosis',
  'diagnosisCode',
  'treatmentDate',
  'facilityName',
  'providerName',
  'procedureCode',
  'procedureDescription',
  'referralDetails',
  'preAuthNumber',
]);

// ─── Service ───────────────────────────────────────

export class ResponseProcessorService {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── processIncomingResponse ─────────────────────

  async processIncomingResponse(
    email: IncomingEmailData,
  ): Promise<ResponseProcessingResult> {
    const noMatchResult: ResponseProcessingResult = {
      matched: false,
      claimId: null,
      claimReference: null,
      extractedFields: {},
      fieldsResolved: [],
      fieldsStillMissing: [],
      pipelineResumed: false,
      action: 'NO_MATCH',
    };

    // Step 1: Match email to an open query
    const matchedQuery = await this.matchEmailToQuery(email);

    if (!matchedQuery) {
      logger.info(
        { fromEmail: email.fromEmail, subject: email.subject },
        'No matching open query found for incoming email',
      );
      return noMatchResult;
    }

    const claim = await this.prisma.claim.findUnique({
      where: { id: matchedQuery.claimId },
    });

    if (!claim) {
      logger.error(
        { claimId: matchedQuery.claimId },
        'Matched query references a non-existent claim',
      );
      return noMatchResult;
    }

    // Step 2: Get missing fields from original query
    const missingFields = this.parseMissingFieldsFromQuery(
      matchedQuery.queryText,
    );

    if (missingFields.length === 0) {
      logger.warn(
        { queryId: matchedQuery.id },
        'Could not extract missing fields from original query text',
      );
    }

    // Step 3: Extract fields from email body
    let extractedFields: Record<string, string | number | null> = {};

    if (missingFields.length > 0) {
      extractedFields = await this.extractFieldsFromText(
        email.body,
        missingFields,
      );
    }

    // Step 4: Process attachments if present
    let action: ResponseProcessingResult['action'] = 'FIELDS_EXTRACTED';

    if (email.attachments && email.attachments.length > 0) {
      const attachmentFields = await this.processAttachments(
        email.attachments,
        missingFields,
      );

      // Merge attachment-extracted fields (do not overwrite existing)
      const mergedFields: Record<string, string | number | null> = {
        ...extractedFields,
      };
      for (const [key, value] of Object.entries(attachmentFields)) {
        if (mergedFields[key] === null || mergedFields[key] === undefined) {
          mergedFields[key] = value;
        }
      }
      extractedFields = mergedFields;
      action = 'ATTACHMENT_PROCESSED';
    }

    // Determine which fields were resolved
    const fieldsResolved = Object.entries(extractedFields)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key]) => key);

    const fieldsStillMissing = missingFields.filter(
      (field) => !fieldsResolved.includes(field),
    );

    if (fieldsResolved.length === 0) {
      logger.info(
        { queryId: matchedQuery.id, claimId: claim.id },
        'Email response did not contain sufficient extractable data',
      );

      // Still record the response text
      await this.prisma.claimQuery.update({
        where: { id: matchedQuery.id },
        data: {
          responseReceivedAt: new Date(),
          responseText: email.body,
        },
      });

      return {
        matched: true,
        claimId: claim.id,
        claimReference: claim.claimReference,
        extractedFields,
        fieldsResolved,
        fieldsStillMissing,
        pipelineResumed: false,
        action: 'INSUFFICIENT_DATA',
      };
    }

    // Step 5: Update claim record with extracted fields
    await this.updateClaimWithExtractedFields(claim, extractedFields);

    // Step 6: Update query status
    const allResolved = fieldsStillMissing.length === 0;

    if (allResolved) {
      await this.prisma.claimQuery.update({
        where: { id: matchedQuery.id },
        data: {
          status: 'RESPONDED',
          responseReceivedAt: new Date(),
          responseText: email.body,
        },
      });

      logger.info(
        { queryId: matchedQuery.id, claimId: claim.id },
        'All missing fields resolved. Query marked as RESPONDED.',
      );
    } else {
      await this.prisma.claimQuery.update({
        where: { id: matchedQuery.id },
        data: {
          responseReceivedAt: new Date(),
          responseText: email.body,
        },
      });

      logger.info(
        { queryId: matchedQuery.id, fieldsStillMissing },
        'Partial response received. Some fields still missing.',
      );
    }

    // Step 7: Resume pipeline if all critical fields resolved
    let pipelineResumed = false;

    if (allResolved && this.isClaimOnHold(claim.status)) {
      await this.prisma.claim.update({
        where: { id: claim.id },
        data: { status: 'VALIDATING' },
      });

      // Re-enqueue the claim to the processing worker to resume the pipeline
      await processingQueue.add(
        'process-claim',
        {
          claimId: claim.id,
          orgId: claim.orgId,
          resumeFromStage: 'COMPLETENESS_CHECK',
        },
        {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          priority: 1,
        },
      );

      // Audit event for pipeline resume
      await this.prisma.auditEvent.create({
        data: {
          eventType: 'PIPELINE_RESUMED',
          actorType: 'SYSTEM',
          targetType: 'CLAIM',
          targetId: claim.id,
          action: 'Pipeline auto-resumed after query response',
          details: {
            queryId: matchedQuery.id,
            fieldsResolved,
            resumeFromStage: 'COMPLETENESS_CHECK',
          },
        },
      });

      pipelineResumed = true;

      logger.info(
        { claimId: claim.id, claimReference: claim.claimReference },
        'Pipeline auto-resumed — claim re-enqueued for processing from COMPLETENESS_CHECK',
      );
    }

    return {
      matched: true,
      claimId: claim.id,
      claimReference: claim.claimReference,
      extractedFields,
      fieldsResolved,
      fieldsStillMissing,
      pipelineResumed,
      action,
    };
  }

  // ─── extractFieldsFromText (private) ─────────────

  private async extractFieldsFromText(
    text: string,
    missingFields: string[],
  ): Promise<Record<string, string | number | null>> {
    const fieldList = missingFields
      .map((f, idx) => `${idx + 1}. ${f}`)
      .join('\n');

    const prompt = [
      'The following email is a response to a claim query requesting specific information.',
      'Extract any provided information for the fields listed below.',
      '',
      'Missing fields requested:',
      fieldList,
      '',
      'Email body:',
      '---',
      text,
      '---',
      '',
      'Return a JSON object mapping each field name to the extracted value.',
      'Use the exact field names from the list above as keys.',
      'If a field is not found in the email, set its value to null.',
      'Return ONLY the JSON object, no additional text or markdown.',
    ].join('\n');

    try {
      const rawResponse = await invokeBedrockModel(prompt, {
        temperature: 0.1,
        maxTokens: 2048,
      });

      const cleaned = rawResponse
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      const parsed = JSON.parse(cleaned) as Record<
        string,
        string | number | null
      >;

      logger.info(
        { fieldCount: Object.keys(parsed).length },
        'Fields extracted from email response via Bedrock',
      );

      return parsed;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown extraction error';

      logger.error(
        { error: errorMsg },
        'Failed to extract fields from email text via Bedrock',
      );

      // Return all fields as null on failure
      const emptyResult: Record<string, string | number | null> = {};
      for (const field of missingFields) {
        emptyResult[field] = null;
      }
      return emptyResult;
    }
  }

  // ─── parseMissingFieldsFromQuery ─────────────────

  private parseMissingFieldsFromQuery(queryText: string): string[] {
    const fields: string[] = [];

    // Match numbered items: "1. Field name" or "  1. Field name"
    const numberedPattern = /^\s*\d+\.\s+(.+)$/gm;
    let match = numberedPattern.exec(queryText);
    while (match !== null) {
      const field = match[1].trim();
      if (field.length > 0) {
        fields.push(field);
      }
      match = numberedPattern.exec(queryText);
    }

    if (fields.length > 0) {
      return fields;
    }

    // Match bullet items: "- Field name" or "* Field name" or "  * Field name"
    const bulletPattern = /^\s*[*\-\u2022]\s+(.+)$/gm;
    match = bulletPattern.exec(queryText);
    while (match !== null) {
      const field = match[1].trim();
      if (field.length > 0) {
        fields.push(field);
      }
      match = bulletPattern.exec(queryText);
    }

    return fields;
  }

  // ─── matchEmailToQuery (private) ─────────────────

  private async matchEmailToQuery(
    email: IncomingEmailData,
  ): Promise<{ id: string; claimId: string; queryText: string } | null> {
    // Check 1: QRY reference in subject
    const refMatch = QRY_REFERENCE_PATTERN.exec(email.subject);
    if (refMatch) {
      const claimRef = refMatch[1];
      const seq = refMatch[2];
      const queryRef = `QRY-${claimRef}-${seq}`;

      const matchedByRef = await this.prisma.claimQuery.findFirst({
        where: {
          queryText: { contains: `[${queryRef}]` },
          status: { in: [...OPEN_QUERY_STATUSES] },
        },
        select: { id: true, claimId: true, queryText: true },
      });

      if (matchedByRef) {
        logger.info({ queryRef }, 'Matched email to query by QRY reference');
        return matchedByRef;
      }
    }

    // Check 2: Match by threadId
    if (email.threadId) {
      const correspondence = await this.prisma.claimCorrespondence.findFirst({
        where: { gmailThreadId: email.threadId },
        select: { claimId: true },
      });

      if (correspondence) {
        const matchedByThread = await this.prisma.claimQuery.findFirst({
          where: {
            claimId: correspondence.claimId,
            status: { in: [...OPEN_QUERY_STATUSES] },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, claimId: true, queryText: true },
        });

        if (matchedByThread) {
          logger.info(
            { threadId: email.threadId },
            'Matched email to query by thread ID',
          );
          return matchedByThread;
        }
      }
    }

    // Check 3: Match by sender email
    const correspondenceFromSender =
      await this.prisma.claimCorrespondence.findMany({
        where: { fromEmail: email.fromEmail },
        select: { claimId: true },
      });

    const claimIds = [
      ...new Set(correspondenceFromSender.map((c) => c.claimId)),
    ];

    if (claimIds.length > 0) {
      const matchedBySender = await this.prisma.claimQuery.findFirst({
        where: {
          claimId: { in: claimIds },
          status: { in: [...OPEN_QUERY_STATUSES] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, claimId: true, queryText: true },
      });

      if (matchedBySender) {
        logger.info(
          { fromEmail: email.fromEmail },
          'Matched email to query by sender email',
        );
        return matchedBySender;
      }
    }

    return null;
  }

  // ─── processAttachments (private) ────────────────

  private async processAttachments(
    attachments: ReadonlyArray<{
      filename: string;
      content: string;
      mimeType: string;
    }>,
    missingFields: string[],
  ): Promise<Record<string, string | number | null>> {
    const combined: Record<string, string | number | null> = {};

    for (const attachment of attachments) {
      if (attachment.mimeType === 'application/pdf') {
        logger.info(
          { filename: attachment.filename },
          'PDF attachment detected. Full PDF extraction requires pdfParserService in production.',
        );
        // In production, pdfParserService would extract text from the PDF.
        // For now, skip PDF binary content extraction.
        continue;
      }

      // For text-based attachments, attempt field extraction
      const isTextBased =
        attachment.mimeType.startsWith('text/') ||
        attachment.mimeType === 'application/json';

      if (isTextBased && attachment.content.length > 0) {
        const extracted = await this.extractFieldsFromText(
          attachment.content,
          missingFields,
        );

        for (const [key, value] of Object.entries(extracted)) {
          if (
            value !== null &&
            value !== undefined &&
            (combined[key] === null || combined[key] === undefined)
          ) {
            combined[key] = value;
          }
        }
      }
    }

    return combined;
  }

  // ─── updateClaimWithExtractedFields (private) ────

  private async updateClaimWithExtractedFields(
    claim: any,
    extractedFields: Record<string, string | number | null>,
  ): Promise<void> {
    const claimantUpdates: Record<string, string | number | null> = {};
    const financialUpdates: Record<string, string | number | null> = {};
    const treatmentUpdates: Record<string, string | number | null> = {};

    for (const [key, value] of Object.entries(extractedFields)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (CLAIMANT_FIELDS.has(key)) {
        claimantUpdates[key] = value;
      } else if (FINANCIAL_FIELDS.has(key)) {
        financialUpdates[key] = value;
      } else if (TREATMENT_FIELDS.has(key)) {
        treatmentUpdates[key] = value;
      }
    }

    const updateData: Record<string, unknown> = {};

    if (Object.keys(claimantUpdates).length > 0) {
      const existingClaimant =
        (claim.claimant as Record<string, unknown>) ?? {};
      updateData.claimant = { ...existingClaimant, ...claimantUpdates };
    }

    if (Object.keys(financialUpdates).length > 0) {
      const existingFinancials =
        (claim.financials as Record<string, unknown>) ?? {};
      updateData.financials = { ...existingFinancials, ...financialUpdates };
    }

    if (Object.keys(treatmentUpdates).length > 0) {
      const existingTreatment =
        (claim.treatment as Record<string, unknown>) ?? {};
      updateData.treatment = { ...existingTreatment, ...treatmentUpdates };
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.claim.update({
        where: { id: claim.id },
        data: updateData,
      });

      logger.info(
        {
          claimId: claim.id,
          updatedSections: Object.keys(updateData),
        },
        'Claim record updated with extracted fields',
      );
    }
  }

  // ─── isClaimOnHold (private) ─────────────────────

  private isClaimOnHold(status: string): boolean {
    return (HOLD_STATUSES as ReadonlyArray<string>).includes(status);
  }
}
