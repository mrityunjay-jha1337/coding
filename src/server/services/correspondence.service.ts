import { PrismaClient, type ClaimQuery } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface GenerateQueryParams {
  readonly claimId: string;
  readonly queryType:
    | 'missing_info'
    | 'clarification'
    | 'additional_docs'
    | 'medical_clarification'
    | 'financial_reconciliation'
    | 'identity_verification';
  readonly missingFields: string[];
  readonly ambiguities?: string[];
  readonly recipientEmail: string;
  readonly recipientName?: string;
  readonly claimReference: string;
  readonly autoSend?: boolean;
}

interface MatchEmailInput {
  readonly threadId?: string;
  readonly subject: string;
  readonly fromEmail: string;
}

type AutoResponseType =
  | 'claim_received'
  | 'documents_received'
  | 'claim_completed'
  | 'status_update';

interface AutoResponseContext {
  readonly claimReference: string;
  readonly claimantName?: string;
  readonly status?: string;
}

// ─── Constants ─────────────────────────────────────

const QRY_REFERENCE_PATTERN = /\[QRY-([A-Za-z0-9-]+)-(\d+)\]/;
const BUSINESS_DAYS_REPLY_DEADLINE = 10;
const BUSINESS_DAYS_FOLLOW_UP = 5;
const OPEN_QUERY_STATUSES = ['SENT', 'AWAITING_RESPONSE'] as const;

// ─── Helpers ──────────────────────────────────────

/**
 * Add N business days (Mon-Fri) to a given date.
 * Returns a new Date; the original is never mutated.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added += 1;
    }
  }
  return result;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ─── Service ──────────────────────────────────────

export class CorrespondenceService {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── generateQuery ────────────────────────────

  async generateQuery(params: GenerateQueryParams): Promise<ClaimQuery> {
    const {
      claimId,
      queryType,
      missingFields,
      ambiguities,
      recipientEmail,
      recipientName,
      claimReference,
      autoSend,
    } = params;

    if (missingFields.length === 0) {
      throw new Error('missingFields must contain at least one item');
    }

    const sequenceNumber = await this.getNextSequenceNumber(claimId);
    const now = new Date();
    const replyByDate = addBusinessDays(now, BUSINESS_DAYS_REPLY_DEADLINE);
    const queryRef = `QRY-${claimReference}-${sequenceNumber}`;

    const subject = `[${queryRef}] Information required for your claim`;

    const body = this.buildQueryBody({
      queryRef,
      recipientName: recipientName ?? 'Sir/Madam',
      claimReference,
      queryType,
      missingFields,
      ambiguities,
      replyByDate,
      recipientEmail,
    });

    const queryText = `Subject: ${subject}\n\n${body}`;

    const status = autoSend ? 'SENT' : 'DRAFT';
    const sentAt = autoSend ? now : undefined;
    const nextFollowUp = autoSend
      ? addBusinessDays(now, BUSINESS_DAYS_FOLLOW_UP)
      : undefined;

    const queryData = {
      claimId,
      queryType,
      queryText,
      status,
      sentAt: sentAt ?? null,
      nextFollowUp: nextFollowUp ?? null,
    };

    const query = await this.prisma.claimQuery.create({
      data: queryData as any,
    });

    logger.info(
      { queryId: query.id, claimId, queryType, status, queryRef },
      'Claim query generated',
    );

    return query;
  }

  // ─── matchQueryResponse ───────────────────────

  async matchQueryResponse(email: MatchEmailInput): Promise<ClaimQuery | null> {
    // Check 1: Extract QRY reference from subject
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
      });

      if (matchedByRef) {
        return matchedByRef;
      }
    }

    // Check 2: Match by threadId on claim_correspondence linked to open queries
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
        });

        if (matchedByThread) {
          return matchedByThread;
        }
      }
    }

    // Check 3: Match by sender email + open queries
    const claimsFromSender = await this.prisma.claimCorrespondence.findMany({
      where: { fromEmail: email.fromEmail },
      select: { claimId: true },
    });

    const claimIds = [...new Set(claimsFromSender.map((c) => c.claimId))];

    if (claimIds.length > 0) {
      const matchedBySender = await this.prisma.claimQuery.findFirst({
        where: {
          claimId: { in: claimIds },
          status: { in: [...OPEN_QUERY_STATUSES] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (matchedBySender) {
        return matchedBySender;
      }
    }

    return null;
  }

  // ─── processQueryResponse ─────────────────────

  async processQueryResponse(
    queryId: string,
    responseText: string,
  ): Promise<ClaimQuery> {
    const updated = await this.prisma.claimQuery.update({
      where: { id: queryId },
      data: {
        status: 'RESPONDED',
        responseReceivedAt: new Date(),
        responseText,
      },
    });

    logger.info(
      { queryId, claimId: updated.claimId },
      'Query response processed',
    );

    return updated;
  }

  // ─── getOpenQueries ───────────────────────────

  async getOpenQueries(claimId: string): Promise<ClaimQuery[]> {
    return this.prisma.claimQuery.findMany({
      where: {
        claimId,
        status: { in: [...OPEN_QUERY_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── getOverdueQueries ────────────────────────

  async getOverdueQueries(): Promise<ClaimQuery[]> {
    return this.prisma.claimQuery.findMany({
      where: {
        nextFollowUp: { lt: new Date() },
        status: 'AWAITING_RESPONSE',
      },
      orderBy: { nextFollowUp: 'asc' },
    });
  }

  // ─── generateAutoResponse ─────────────────────

  generateAutoResponse(
    type: AutoResponseType,
    context: AutoResponseContext,
  ): string {
    const { claimReference, claimantName, status } = context;
    const greeting = claimantName ? `Dear ${claimantName}` : 'Dear Sir/Madam';
    const complianceFooter = this.buildComplianceFooter();

    switch (type) {
      case 'claim_received':
        return [
          `${greeting},`,
          '',
          `Thank you for your claim submission. We confirm receipt of your claim under reference ${claimReference}.`,
          '',
          'Our team will review the documentation provided and aim to acknowledge your claim formally within 5 business days. Should we require any further information, we will contact you directly.',
          '',
          'Please quote your claim reference in all future correspondence.',
          '',
          'Yours faithfully,',
          'Claims Processing Team',
          '',
          complianceFooter,
        ].join('\n');

      case 'documents_received':
        return [
          `${greeting},`,
          '',
          `We write to confirm receipt of the additional documents you have provided in connection with claim reference ${claimReference}.`,
          '',
          'These documents have been added to your claim file and will be reviewed by your assigned handler. We will be in contact should any further information be required.',
          '',
          'Yours faithfully,',
          'Claims Processing Team',
          '',
          complianceFooter,
        ].join('\n');

      case 'claim_completed':
        return [
          `${greeting},`,
          '',
          `We are pleased to confirm that the processing of your claim under reference ${claimReference} has been completed.`,
          '',
          'A detailed settlement statement will follow under separate cover. Should you have any queries regarding the outcome, please do not hesitate to contact us quoting your claim reference.',
          '',
          'Yours faithfully,',
          'Claims Processing Team',
          '',
          complianceFooter,
        ].join('\n');

      case 'status_update':
        return [
          `${greeting},`,
          '',
          `We write to provide you with an update on your claim under reference ${claimReference}.`,
          '',
          `Current status: ${status ?? 'In Progress'}`,
          '',
          'Our team continues to progress your claim and we will notify you of any material developments. Should you require further assistance in the interim, please contact us quoting your claim reference.',
          '',
          'Yours faithfully,',
          'Claims Processing Team',
          '',
          complianceFooter,
        ].join('\n');

      default: {
        const exhaustiveCheck: never = type;
        throw new Error(`Unknown auto-response type: ${exhaustiveCheck}`);
      }
    }
  }

  // ─── buildComplianceFooter ────────────────────

  buildComplianceFooter(): string {
    return [
      '---',
      'REGULATORY NOTICE',
      '',
      'This firm is authorised and regulated by the Financial Conduct Authority (FCA). Our FCA registration details can be verified on the Financial Services Register at https://register.fca.org.uk.',
      '',
      'DATA PROTECTION',
      'We process your personal data in accordance with the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018. For details on how we handle your information, please refer to our Privacy Notice available on our website.',
      '',
      'COMPLAINTS',
      'If you are dissatisfied with any aspect of our service, please contact our Complaints Department. If you remain unhappy after receiving our final response, you may refer the matter to the Financial Ombudsman Service within six months. Contact: Financial Ombudsman Service, Exchange Tower, London E14 9SR. Telephone: 0800 023 4567. Website: www.financial-ombudsman.org.uk.',
    ].join('\n');
  }

  // ─── Private Helpers ──────────────────────────

  private async getNextSequenceNumber(claimId: string): Promise<number> {
    const existingCount = await this.prisma.claimQuery.count({
      where: { claimId },
    });
    return existingCount + 1;
  }

  private buildQueryBody(params: {
    queryRef: string;
    recipientName: string;
    claimReference: string;
    queryType: string;
    missingFields: string[];
    ambiguities?: string[];
    replyByDate: Date;
    recipientEmail: string;
  }): string {
    const {
      queryRef,
      recipientName,
      claimReference,
      queryType,
      missingFields,
      ambiguities,
      replyByDate,
    } = params;

    const queryTypeLabel = this.formatQueryTypeLabel(queryType);

    const missingFieldsList = missingFields
      .map((field, idx) => `  ${idx + 1}. ${field}`)
      .join('\n');

    const ambiguitySection =
      ambiguities && ambiguities.length > 0
        ? [
            '',
            'Additionally, we would be grateful if you could clarify the following:',
            ...ambiguities.map((a, idx) => `  ${idx + 1}. ${a}`),
          ].join('\n')
        : '';

    const complianceFooter = this.buildComplianceFooter();

    return [
      `Dear ${recipientName},`,
      '',
      `Query Reference: ${queryRef}`,
      `Claim Reference: ${claimReference}`,
      `Query Type: ${queryTypeLabel}`,
      '',
      'We are writing in connection with the above-referenced claim. In order to progress your claim, we require the following information:',
      '',
      missingFieldsList,
      ambiguitySection,
      '',
      `Please provide the requested information by ${formatDate(replyByDate)} (${BUSINESS_DAYS_REPLY_DEADLINE} business days from the date of this letter).`,
      '',
      'Should we not receive a response within the specified timeframe, we may be unable to progress your claim further and it may be necessary to make a decision based on the information currently available.',
      '',
      'Yours faithfully,',
      'Claims Processing Team',
      '',
      complianceFooter,
    ].join('\n');
  }

  private formatQueryTypeLabel(queryType: string): string {
    const labels: Record<string, string> = {
      missing_info: 'Missing Information',
      clarification: 'Clarification Required',
      additional_docs: 'Additional Documentation Required',
      medical_clarification: 'Medical Clarification',
      financial_reconciliation: 'Financial Reconciliation',
      identity_verification: 'Identity Verification',
    };
    return labels[queryType] ?? queryType;
  }
}
