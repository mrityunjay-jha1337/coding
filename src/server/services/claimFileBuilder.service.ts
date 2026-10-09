import { PrismaClient } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface CodingSummary {
  readonly code: string;
  readonly codeType: string;
  readonly description: string;
  readonly confidence: number;
  readonly isValidated: boolean;
  readonly evidenceSource: string | null;
  readonly pageNumber: number | null;
  readonly reviewerAction: string | null;
}

export interface DocumentSummary {
  readonly id: string;
  readonly filename: string;
  readonly docType: string;
  readonly language: string | null;
  readonly pageCount: number | null;
  readonly extractionConfidence: number | null;
}

export interface CorrespondenceSummary {
  readonly direction: string;
  readonly type: string;
  readonly fromEmail: string;
  readonly toEmail: string;
  readonly subject: string;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
}

export interface AuditSummary {
  readonly eventType: string;
  readonly action: string;
  readonly actorType: string;
  readonly details: unknown;
  readonly createdAt: Date;
}

export interface ClaimFile {
  readonly claimReference: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;

  readonly claimant: Record<string, unknown> | null;
  readonly policy: Record<string, unknown> | null;
  readonly incident: Record<string, unknown> | null;
  readonly treatment: Record<string, unknown> | null;

  readonly medicalCoding: {
    readonly primaryDiagnosis: CodingSummary | null;
    readonly secondaryDiagnoses: readonly CodingSummary[];
    readonly procedures: readonly CodingSummary[];
    readonly overallCodingConfidence: number;
  };

  readonly financials: Record<string, unknown> | null;

  readonly documents: readonly DocumentSummary[];
  readonly correspondence: readonly CorrespondenceSummary[];
  readonly auditTrail: readonly AuditSummary[];

  readonly processingMetrics: {
    readonly totalProcessingTimeMs: number | null;
    readonly overallConfidence: number | null;
    readonly codesExtracted: number;
    readonly humanInterventions: number;
    readonly queriesSent: number;
  };
}

// ─── Constants ─────────────────────────────────────

const PDF_MARGIN = 50;
const PDF_FONT_SIZE_TITLE = 18;
const PDF_FONT_SIZE_HEADING = 14;
const PDF_FONT_SIZE_BODY = 10;
const PDF_FONT_SIZE_SMALL = 8;
const PDF_LINE_HEIGHT = 1.3;
const BRANDING_COLOR = '#1a365d';
const TABLE_HEADER_BG = '#e2e8f0';
const CONFIDENTIALITY_NOTICE =
  'CONFIDENTIAL: This document contains sensitive claims and medical information. ' +
  'Unauthorised disclosure is prohibited under UK GDPR and Data Protection Act 2018.';

const PROCEDURE_CODE_TYPES = new Set(['OPCS4', 'CPT']);

// ─── Errors ────────────────────────────────────────

export class ClaimFileNotFoundError extends Error {
  constructor(claimId: string) {
    super(`Claim not found: ${claimId}`);
    this.name = 'ClaimFileNotFoundError';
  }
}

// ─── Service ───────────────────────────────────────

export class ClaimFileBuilderService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Build a structured claim file from DB records.
   */
  async buildClaimFile(claimId: string): Promise<ClaimFile> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        documents: true,
        coding: {
          orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }],
        },
        correspondence: {
          orderBy: { createdAt: 'desc' },
        },
        escalations: {
          orderBy: { createdAt: 'desc' },
        },
        queries: true,
      },
    });

    if (!claim) {
      throw new ClaimFileNotFoundError(claimId);
    }

    const auditEvents = await this.prisma.auditEvent.findMany({
      where: { targetId: claimId, targetType: 'CLAIM' },
      orderBy: { createdAt: 'desc' },
    });

    const codingSummaries = claim.coding.map(toCodingSummary);
    const { primaryDiagnosis, secondaryDiagnoses, procedures } =
      separateCoding(codingSummaries);

    const overallCodingConfidence = computeOverallCodingConfidence(
      codingSummaries,
    );

    const humanInterventions = claim.coding.filter(
      (c) => c.reviewerAction !== null,
    ).length;

    const queriesSent = claim.queries.filter(
      (q) => q.status !== 'DRAFT',
    ).length;

    logger.debug(
      { claimId, codesCount: claim.coding.length },
      'Built claim file',
    );

    return {
      claimReference: claim.claimReference,
      status: claim.status,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      completedAt: claim.completedAt,

      claimant: claim.claimant as Record<string, unknown> | null,
      policy: claim.policy as Record<string, unknown> | null,
      incident: claim.incident as Record<string, unknown> | null,
      treatment: claim.treatment as Record<string, unknown> | null,

      medicalCoding: {
        primaryDiagnosis,
        secondaryDiagnoses,
        procedures,
        overallCodingConfidence,
      },

      financials: claim.financials as Record<string, unknown> | null,

      documents: claim.documents.map(toDocumentSummary),
      correspondence: claim.correspondence.map(toCorrespondenceSummary),
      auditTrail: auditEvents.map(toAuditSummary),

      processingMetrics: {
        totalProcessingTimeMs: claim.processingTimeMs,
        overallConfidence: claim.overallConfidence,
        codesExtracted: claim.coding.length,
        humanInterventions,
        queriesSent,
      },
    };
  }

  /**
   * Generate a professional PDF from a ClaimFile.
   */
  async generateClaimPdf(claimFile: ClaimFile): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: PDF_MARGIN,
            bottom: PDF_MARGIN,
            left: PDF_MARGIN,
            right: PDF_MARGIN,
          },
          bufferPages: true,
          info: {
            Title: `Claim File - ${claimFile.claimReference}`,
            Author: 'ClaimsIntell',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // ── Page 1: Header + Claim Summary ──
        renderHeader(doc, claimFile);
        renderClaimSummary(doc, claimFile);

        // ── Page 2: Medical Coding ──
        doc.addPage();
        renderMedicalCoding(doc, claimFile);

        // ── Page 3: Financial Summary ──
        doc.addPage();
        renderFinancials(doc, claimFile);

        // ── Page 4: Processing Audit Trail ──
        doc.addPage();
        renderAuditTrail(doc, claimFile);

        // ── Add footer to all pages ──
        addFooters(doc, claimFile);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate bordereau rows for completed claims within a date range.
   */
  async generateBordereau(
    orgId: string,
    clientId: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<Array<Record<string, unknown>>> {
    const claims = await this.prisma.claim.findMany({
      where: {
        orgId,
        clientId,
        status: 'COMPLETE',
        completedAt: {
          gte: dateFrom,
          lte: dateTo,
        },
      },
      include: {
        coding: {
          where: { isPrimary: true, codeType: 'ICD10' },
          take: 1,
        },
      },
      orderBy: { completedAt: 'asc' },
    });

    return claims.map((claim) => {
      const claimant = claim.claimant as Record<string, unknown> | null;
      const policy = claim.policy as Record<string, unknown> | null;
      const incident = claim.incident as Record<string, unknown> | null;
      const financials = claim.financials as Record<string, unknown> | null;
      const primaryCode = claim.coding[0] ?? null;

      return {
        claimRef: claim.claimReference,
        claimantName: (claimant?.fullName ?? claimant?.name) ?? null,
        policyNum:
          (claimant?.membershipNumber ?? policy?.membershipNumber ?? policy?.policyNumber) ?? null,
        incidentDate: (incident?.date ?? null),
        primaryIcd10: primaryCode?.code ?? null,
        totalClaimed: financials?.totalClaimed ?? null,
        currency: financials?.currency ?? 'GBP',
        status: claim.status,
        completedAt: claim.completedAt,
        confidence: claim.overallConfidence,
      };
    });
  }
}

// ─── Mapping helpers ──────────────────────────────

function toCodingSummary(coding: {
  code: string;
  codeType: string;
  description: string;
  confidence: number;
  isValidated: boolean;
  evidenceSource: string | null;
  pageNumber: number | null;
  reviewerAction: string | null;
}): CodingSummary {
  return {
    code: coding.code,
    codeType: coding.codeType,
    description: coding.description,
    confidence: coding.confidence,
    isValidated: coding.isValidated,
    evidenceSource: coding.evidenceSource,
    pageNumber: coding.pageNumber,
    reviewerAction: coding.reviewerAction,
  };
}

function toDocumentSummary(doc: {
  id: string;
  originalFilename: string;
  docType: string;
  language: string | null;
  pageCount: number | null;
  extractionConfidence: number | null;
}): DocumentSummary {
  return {
    id: doc.id,
    filename: doc.originalFilename,
    docType: doc.docType,
    language: doc.language,
    pageCount: doc.pageCount,
    extractionConfidence: doc.extractionConfidence,
  };
}

function toCorrespondenceSummary(corr: {
  direction: string;
  type: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  sentAt: Date | null;
  createdAt: Date;
}): CorrespondenceSummary {
  return {
    direction: corr.direction,
    type: corr.type,
    fromEmail: corr.fromEmail,
    toEmail: corr.toEmail,
    subject: corr.subject,
    sentAt: corr.sentAt,
    createdAt: corr.createdAt,
  };
}

function toAuditSummary(event: {
  eventType: string;
  action: string;
  actorType: string;
  details: unknown;
  createdAt: Date;
}): AuditSummary {
  return {
    eventType: event.eventType,
    action: event.action,
    actorType: event.actorType,
    details: event.details,
    createdAt: event.createdAt,
  };
}

// ─── Coding separation ────────────────────────────

function separateCoding(summaries: readonly CodingSummary[]): {
  primaryDiagnosis: CodingSummary | null;
  secondaryDiagnoses: readonly CodingSummary[];
  procedures: readonly CodingSummary[];
} {
  const diagnoses: CodingSummary[] = [];
  const procedures: CodingSummary[] = [];

  for (const s of summaries) {
    if (PROCEDURE_CODE_TYPES.has(s.codeType)) {
      procedures.push(s);
    } else {
      diagnoses.push(s);
    }
  }

  const primaryDiagnosis = diagnoses.length > 0 ? diagnoses[0] : null;
  const secondaryDiagnoses = diagnoses.length > 1 ? diagnoses.slice(1) : [];

  return { primaryDiagnosis, secondaryDiagnoses, procedures };
}

function computeOverallCodingConfidence(
  summaries: readonly CodingSummary[],
): number {
  if (summaries.length === 0) {
    return 0;
  }
  const total = summaries.reduce((sum, s) => sum + s.confidence, 0);
  return Math.round((total / summaries.length) * 100) / 100;
}

// ─── PDF Rendering helpers ────────────────────────

function renderHeader(doc: PDFKit.PDFDocument, claimFile: ClaimFile): void {
  doc
    .fontSize(PDF_FONT_SIZE_TITLE)
    .fillColor(BRANDING_COLOR)
    .text('ClaimsIntell', PDF_MARGIN, PDF_MARGIN, { align: 'left' })
    .fontSize(PDF_FONT_SIZE_SMALL)
    .fillColor('#718096')
    .text('Autonomous Claims Processing', { align: 'left' });

  doc.moveDown(0.5);

  doc
    .fontSize(PDF_FONT_SIZE_HEADING)
    .fillColor(BRANDING_COLOR)
    .text(`Claim File: ${claimFile.claimReference}`, { align: 'left' });

  doc
    .fontSize(PDF_FONT_SIZE_BODY)
    .fillColor('#2d3748')
    .text(`Status: ${claimFile.status}`, { align: 'left' })
    .text(`Generated: ${new Date().toISOString().slice(0, 10)}`, {
      align: 'left',
    });

  doc.moveDown(1);
  doc
    .strokeColor('#e2e8f0')
    .lineWidth(1)
    .moveTo(PDF_MARGIN, doc.y)
    .lineTo(doc.page.width - PDF_MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.5);
}

function renderClaimSummary(
  doc: PDFKit.PDFDocument,
  claimFile: ClaimFile,
): void {
  renderSectionTitle(doc, 'Claim Summary');

  const claimant = claimFile.claimant ?? {};
  const incident = claimFile.incident ?? {};
  const treatment = claimFile.treatment ?? {};
  const policy = claimFile.policy ?? {};

  // The Bupa pipeline writes the canonical field names below; fall back to
  // legacy aliases (`name`, `policyNumber`, `date`, `summary`) so any older
  // fixtures still render. Without this, every field displays N/A even when
  // the data is present in the DB.
  const claimantName = claimant.fullName ?? claimant.name ?? null;
  const policyNumber =
    claimant.membershipNumber ?? policy.membershipNumber ?? policy.policyNumber ?? null;
  const incidentDate =
    treatment.treatmentDate ??
    treatment.admissionDate ??
    treatment.symptomStartDate ??
    incident.date ??
    null;
  const incidentDescription =
    treatment.reasonForTreatment ??
    treatment.treatmentType ??
    incident.description ??
    null;
  const treatmentSummary =
    treatment.treatmentDescription ??
    treatment.treatmentType ??
    treatment.summary ??
    null;

  const summaryRows: Array<[string, string]> = [
    ['Claim Reference', claimFile.claimReference],
    ['Status', claimFile.status],
    ['Claimant Name', String(claimantName ?? 'N/A')],
    ['Date of Birth', String(claimant.dateOfBirth ?? 'N/A')],
    ['Policy Number', String(policyNumber ?? 'N/A')],
    ['Incident Date', String(incidentDate ?? 'N/A')],
    ['Incident Description', String(incidentDescription ?? 'N/A')],
    ['Treatment Summary', String(treatmentSummary ?? 'N/A')],
    ['Created', claimFile.createdAt.toISOString().slice(0, 10)],
    ['Completed', claimFile.completedAt?.toISOString().slice(0, 10) ?? 'N/A'],
  ];

  for (const [label, value] of summaryRows) {
    doc
      .fontSize(PDF_FONT_SIZE_BODY)
      .fillColor('#4a5568')
      .text(`${label}: `, { continued: true, lineGap: PDF_LINE_HEIGHT })
      .fillColor('#2d3748')
      .text(value);
  }

  // Documents section
  if (claimFile.documents.length > 0) {
    doc.moveDown(0.5);
    renderSectionTitle(doc, 'Documents');
    for (const d of claimFile.documents) {
      doc
        .fontSize(PDF_FONT_SIZE_BODY)
        .fillColor('#2d3748')
        .text(
          `- ${d.filename} (${d.docType}, ${d.pageCount ?? '?'} pages, ` +
            `confidence: ${d.extractionConfidence ?? 'N/A'})`,
        );
    }
  }
}

function renderMedicalCoding(
  doc: PDFKit.PDFDocument,
  claimFile: ClaimFile,
): void {
  renderSectionTitle(doc, 'Medical Coding');

  const { primaryDiagnosis, secondaryDiagnoses, procedures } =
    claimFile.medicalCoding;

  const allCodes: CodingSummary[] = [
    ...(primaryDiagnosis ? [primaryDiagnosis] : []),
    ...secondaryDiagnoses,
    ...procedures,
  ];

  if (allCodes.length === 0) {
    doc
      .fontSize(PDF_FONT_SIZE_BODY)
      .fillColor('#718096')
      .text('No medical codes have been extracted for this claim.');
    return;
  }

  // Table header
  const colX = [PDF_MARGIN, 130, 190, 360, 430, 490];
  const colHeaders = [
    'Code',
    'Type',
    'Description',
    'Confidence',
    'Validated',
    'Reviewer',
  ];
  const headerY = doc.y;

  doc
    .rect(PDF_MARGIN, headerY, doc.page.width - 2 * PDF_MARGIN, 18)
    .fill(TABLE_HEADER_BG);

  doc.fontSize(PDF_FONT_SIZE_SMALL).fillColor(BRANDING_COLOR);
  for (let i = 0; i < colHeaders.length; i++) {
    doc.text(colHeaders[i], colX[i], headerY + 4, { width: 80 });
  }

  let rowY = headerY + 22;

  for (const code of allCodes) {
    if (rowY > doc.page.height - 80) {
      doc.addPage();
      rowY = PDF_MARGIN;
    }

    doc.fontSize(PDF_FONT_SIZE_SMALL).fillColor('#2d3748');
    doc.text(code.code, colX[0], rowY, { width: 78 });
    doc.text(code.codeType, colX[1], rowY, { width: 58 });
    doc.text(truncate(code.description, 40), colX[2], rowY, { width: 168 });
    doc.text(`${(code.confidence * 100).toFixed(0)}%`, colX[3], rowY, {
      width: 48,
    });
    doc.text(code.isValidated ? 'Yes' : 'No', colX[4], rowY, { width: 48 });
    doc.text(code.reviewerAction ?? '-', colX[5], rowY, { width: 48 });

    rowY += 16;
  }

  doc.y = rowY + 10;

  doc
    .fontSize(PDF_FONT_SIZE_BODY)
    .fillColor('#4a5568')
    .text(
      `Overall Coding Confidence: ${(claimFile.medicalCoding.overallCodingConfidence * 100).toFixed(1)}%`,
    );
}

function renderFinancials(
  doc: PDFKit.PDFDocument,
  claimFile: ClaimFile,
): void {
  renderSectionTitle(doc, 'Financial Summary');

  const financials = claimFile.financials;
  if (!financials) {
    doc
      .fontSize(PDF_FONT_SIZE_BODY)
      .fillColor('#718096')
      .text('No financial data available for this claim.');
    return;
  }

  const rows = Object.entries(financials);
  for (const [key, value] of rows) {
    // Itemised charges and other line-item arrays render as a labelled list
    // rather than the default `String(value)` path, which would produce
    // "[object Object]" entries.
    if (Array.isArray(value)) {
      doc
        .fontSize(PDF_FONT_SIZE_BODY)
        .fillColor('#4a5568')
        .text(`${formatLabel(key)}:`);
      if (value.length === 0) {
        doc.fillColor('#2d3748').text('  N/A');
      } else {
        for (const item of value) {
          doc.fillColor('#2d3748').text(`  - ${formatLineItem(item)}`);
        }
      }
      continue;
    }
    doc
      .fontSize(PDF_FONT_SIZE_BODY)
      .fillColor('#4a5568')
      .text(`${formatLabel(key)}: `, { continued: true })
      .fillColor('#2d3748')
      .text(String(value ?? 'N/A'));
  }

  doc.moveDown(1);
  renderSectionTitle(doc, 'Processing Metrics');

  const m = claimFile.processingMetrics;
  const metricRows: Array<[string, string]> = [
    [
      'Total Processing Time',
      m.totalProcessingTimeMs ? `${m.totalProcessingTimeMs}ms` : 'N/A',
    ],
    [
      'Overall Confidence',
      // overallConfidence can historically be a 0–1 fraction (legacy) or a
      // 0–100 percentage (current pipeline); normalise both for the PDF.
      m.overallConfidence != null
        ? `${(m.overallConfidence <= 1 ? m.overallConfidence * 100 : m.overallConfidence).toFixed(1)}%`
        : 'N/A',
    ],
    ['Codes Extracted', String(m.codesExtracted)],
    ['Human Interventions', String(m.humanInterventions)],
    ['Queries Sent', String(m.queriesSent)],
  ];

  for (const [label, value] of metricRows) {
    doc
      .fontSize(PDF_FONT_SIZE_BODY)
      .fillColor('#4a5568')
      .text(`${label}: `, { continued: true })
      .fillColor('#2d3748')
      .text(value);
  }
}

function renderAuditTrail(
  doc: PDFKit.PDFDocument,
  claimFile: ClaimFile,
): void {
  renderSectionTitle(doc, 'Processing Audit Trail');

  if (claimFile.auditTrail.length === 0) {
    doc
      .fontSize(PDF_FONT_SIZE_BODY)
      .fillColor('#718096')
      .text('No audit events recorded for this claim.');
  } else {
    // Summary count line
    doc
      .fontSize(PDF_FONT_SIZE_SMALL)
      .fillColor('#718096')
      .text(`${claimFile.auditTrail.length} event(s) recorded — shown in reverse-chronological order.`);
    doc.moveDown(0.4);

    for (const event of claimFile.auditTrail) {
      // Estimate block height: ~14 for header + ~12 per detail key
      const detailKeys = event.details && typeof event.details === 'object'
        ? Object.keys(event.details as Record<string, unknown>)
        : [];
      const estimatedHeight = 14 + detailKeys.length * 12 + 8;

      if (doc.y + estimatedHeight > doc.page.height - 60) {
        doc.addPage();
      }

      // Event header line
      doc
        .fontSize(PDF_FONT_SIZE_SMALL)
        .fillColor(BRANDING_COLOR)
        .text(
          `[${event.createdAt.toISOString().slice(0, 19)}]  ` +
            `${event.eventType}  —  ${event.action}  (${event.actorType})`,
          { continued: false },
        );

      // Detail key-value pairs
      if (detailKeys.length > 0) {
        const details = event.details as Record<string, unknown>;
        for (const key of detailKeys) {
          const raw = details[key];
          let displayValue: string;
          if (raw === null || raw === undefined) {
            displayValue = 'N/A';
          } else if (Array.isArray(raw)) {
            displayValue = raw.length === 0 ? '[]' : raw.map((v) =>
              typeof v === 'object' ? JSON.stringify(v) : String(v)
            ).join(', ');
          } else if (typeof raw === 'object') {
            displayValue = JSON.stringify(raw);
          } else {
            displayValue = String(raw);
          }

          // Wrap long values
          const label = `    ${formatLabel(key)}: `;
          doc
            .fontSize(PDF_FONT_SIZE_SMALL)
            .fillColor('#4a5568')
            .text(label, { continued: true })
            .fillColor('#2d3748')
            .text(displayValue, { lineBreak: true });
        }
      } else {
        doc
          .fontSize(PDF_FONT_SIZE_SMALL)
          .fillColor('#a0aec0')
          .text('    (no detail payload)');
      }

      doc.moveDown(0.3);

      // Thin separator line
      doc
        .strokeColor('#e2e8f0')
        .lineWidth(0.5)
        .moveTo(PDF_MARGIN, doc.y)
        .lineTo(doc.page.width - PDF_MARGIN, doc.y)
        .stroke();
      doc.moveDown(0.3);
    }
  }

  // Correspondence summary
  if (claimFile.correspondence.length > 0) {
    if (doc.y > doc.page.height - 100) {
      doc.addPage();
    }
    doc.moveDown(0.5);
    renderSectionTitle(doc, 'Correspondence Log');
    for (const c of claimFile.correspondence) {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
      }
      doc
        .fontSize(PDF_FONT_SIZE_SMALL)
        .fillColor('#4a5568')
        .text(
          `[${c.createdAt.toISOString().slice(0, 19)}] ${c.direction}  —  ` +
            `${c.subject}`,
        );
      doc
        .fontSize(PDF_FONT_SIZE_SMALL)
        .fillColor('#718096')
        .text(`    From: ${c.fromEmail}  →  To: ${c.toEmail}  (${c.type})`);
      doc.moveDown(0.2);
    }
  }
}

function renderSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.5);
  doc.fontSize(PDF_FONT_SIZE_HEADING).fillColor(BRANDING_COLOR).text(title);
  doc.moveDown(0.3);
}

function addFooters(doc: PDFKit.PDFDocument, claimFile: ClaimFile): void {
  const pageCount = doc.bufferedPageRange().count;
  const timestamp = new Date().toISOString();

  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);

    const bottom = doc.page.height - 30;

    doc
      .fontSize(PDF_FONT_SIZE_SMALL)
      .fillColor('#a0aec0')
      .text(
        `${claimFile.claimReference}  |  Page ${i + 1} of ${pageCount}  |  Generated: ${timestamp}`,
        PDF_MARGIN,
        bottom,
        { align: 'center', width: doc.page.width - 2 * PDF_MARGIN },
      );

    doc.text(CONFIDENTIALITY_NOTICE, PDF_MARGIN, bottom + 10, {
      align: 'center',
      width: doc.page.width - 2 * PDF_MARGIN,
    });
  }
}

// ─── Utility ──────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatLabel(camelCase: string): string {
  return camelCase
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatLineItem(item: unknown): string {
  if (item === null || item === undefined) return 'N/A';
  if (typeof item !== 'object') return String(item);

  const obj = item as Record<string, unknown>;
  const description =
    (obj.description as string | undefined) ??
    (obj.name as string | undefined) ??
    (obj.label as string | undefined) ??
    'Item';
  const amount = obj.amount ?? obj.chargedAmount ?? obj.amountClaimed;
  if (amount === undefined || amount === null) return description;
  return `${description}: ${amount}`;
}
