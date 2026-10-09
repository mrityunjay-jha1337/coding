import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { EdiGeneratorService, EdiInput } from './ediGenerator.service';

// ─── Types ─────────────────────────────────────────

export interface BatchExportInput {
  readonly orgId: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly status?: string[];
  readonly planTier?: string;
  readonly claimIds?: string[];
  readonly format: 'INDIVIDUAL' | 'COMBINED' | 'ZIP';
}

export interface BatchExportResult {
  readonly totalClaims: number;
  readonly successCount: number;
  readonly failCount: number;
  readonly errors: ReadonlyArray<{
    claimId: string;
    claimReference: string;
    error: string;
  }>;
  readonly content: string;
  readonly contentType: string;
  readonly filename: string;
  readonly generatedAt: string;
}

export interface ClaimEdiData {
  readonly claimId: string;
  readonly claimReference: string;
  readonly member: {
    membershipNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  } | null;
  readonly provider: {
    providerName: string;
    facilityName: string;
  } | null;
  readonly diagnoses: ReadonlyArray<{
    code: string;
    isPrimary: boolean;
  }>;
  readonly procedures: ReadonlyArray<{
    code: string;
    description: string;
    amount: number;
    serviceDate: string;
  }>;
  readonly totalAmount: number;
  readonly currency: string;
  readonly treatmentDate: string;
  readonly treatmentType: string;
}

// ─── Constants ─────────────────────────────────────

const DEFAULT_SUBMITTER_NAME = 'BUPA GLOBAL';
const DEFAULT_SUBMITTER_ID = 'BUPAGLOBAL';
const DEFAULT_RECEIVER_NAME = 'CLEARINGHOUSE';
const DEFAULT_RECEIVER_ID = 'CLEARINGHS';
const INPATIENT_TREATMENT_TYPE = 'INPATIENT';

// ─── Service ───────────────────────────────────────

export class BatchEdiExportService {
  private readonly prisma: PrismaClient;
  private readonly ediGenerator: EdiGeneratorService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.ediGenerator = new EdiGeneratorService();
  }

  /**
   * Export a batch of claims as EDI 837 documents.
   * Queries claims matching filter criteria, generates EDI for each,
   * persists EdiTransaction records, and returns combined output.
   */
  async exportBatch(input: BatchExportInput): Promise<BatchExportResult> {
    const claims = await this.queryMatchingClaims(input);

    logger.info(
      `Batch EDI export: found ${claims.length} claims for org ${input.orgId}`,
    );

    const errors: Array<{
      claimId: string;
      claimReference: string;
      error: string;
    }> = [];
    const ediContents: string[] = [];
    let successCount = 0;

    for (const claim of claims) {
      try {
        const claimData = await this.getClaimEdiData(claim.id);

        if (!claimData) {
          errors.push({
            claimId: claim.id,
            claimReference: claim.claimReference,
            error: 'Failed to load claim data for EDI generation',
          });
          continue;
        }

        const ediContent = this.buildEdiFromClaimData(claimData);
        ediContents.push(ediContent);

        await this.persistEdiTransaction(claim.id, claimData, ediContent);

        successCount += 1;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error';
        logger.error(
          `Batch EDI export failed for claim ${claim.id}: ${errorMessage}`,
        );
        errors.push({
          claimId: claim.id,
          claimReference: claim.claimReference,
          error: errorMessage,
        });
      }
    }

    const generatedAt = new Date().toISOString();
    const timestamp = generatedAt.replace(/[^0-9]/g, '').slice(0, 14);

    if (input.format === 'INDIVIDUAL') {
      return {
        totalClaims: claims.length,
        successCount,
        failCount: errors.length,
        errors,
        content: JSON.stringify(ediContents),
        contentType: 'application/json',
        filename: `edi-batch-${timestamp}.json`,
        generatedAt,
      };
    }

    // COMBINED (default) or ZIP fallback to combined
    const combinedContent = ediContents.join('\n\n');

    return {
      totalClaims: claims.length,
      successCount,
      failCount: errors.length,
      errors,
      content: combinedContent,
      contentType: 'text/plain',
      filename: `edi-batch-${timestamp}.edi`,
      generatedAt,
    };
  }

  /**
   * Fetch a single claim with all related data needed for EDI generation.
   * Joins claim -> memberClaim -> member, claim -> providerClaim -> provider,
   * and fetches claimCoding for ICD-10 diagnoses.
   */
  async getClaimEdiData(claimId: string): Promise<ClaimEdiData | null> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      return null;
    }

    const financials = claim.financials as Record<string, unknown> | null;
    const treatment = claim.treatment as Record<string, unknown> | null;

    // Fetch member via MemberClaim join
    const memberClaim = await this.prisma.memberClaim.findFirst({
      where: { claimId },
    });

    let memberData: ClaimEdiData['member'] = null;
    if (memberClaim) {
      const member = await this.prisma.member.findUnique({
        where: { id: memberClaim.memberId },
      });
      if (member) {
        memberData = {
          membershipNumber: member.membershipNumber,
          firstName: member.firstName,
          lastName: member.lastName,
          dateOfBirth: member.dateOfBirth.toISOString().split('T')[0],
        };
      }
    }

    // Fetch provider via ProviderClaim join
    const providerClaim = await this.prisma.providerClaim.findFirst({
      where: { claimId },
    });

    let providerData: ClaimEdiData['provider'] = null;
    if (providerClaim) {
      const provider = await this.prisma.provider.findUnique({
        where: { id: providerClaim.providerId },
      });
      if (provider) {
        providerData = {
          providerName: provider.providerName,
          facilityName: provider.facilityName ?? '',
        };
      }
    }

    // Fetch ICD-10 diagnosis codes
    const codings = await this.prisma.claimCoding.findMany({
      where: { claimId },
      orderBy: { isPrimary: 'desc' },
    });

    const diagnoses = codings.map((c) => ({
      code: c.code,
      isPrimary: c.isPrimary,
    }));

    // Extract procedure-like data from coverage decisions if available
    const coverageDecisions = await this.prisma.coverageDecision.findMany({
      where: { claimId },
      orderBy: { lineItemIndex: 'asc' },
    });

    const treatmentDate =
      (treatment?.treatmentDate as string) ??
      new Date().toISOString().split('T')[0];

    const procedures = coverageDecisions.map((d) => ({
      code: `PROC${String(d.lineItemIndex).padStart(3, '0')}`,
      description: d.benefitName,
      amount: d.amountClaimed,
      serviceDate: treatmentDate,
    }));

    return {
      claimId: claim.id,
      claimReference: claim.claimReference,
      member: memberData,
      provider: providerData,
      diagnoses,
      procedures,
      totalAmount: (financials?.totalClaimed as number) ?? 0,
      currency: (financials?.currency as string) ?? 'USD',
      treatmentDate,
      treatmentType: (treatment?.treatmentType as string) ?? 'OUTPATIENT',
    };
  }

  /**
   * Build an EDI 837 document from ClaimEdiData.
   * Uses 837I for INPATIENT treatment types, 837P for all others.
   */
  private buildEdiFromClaimData(data: ClaimEdiData): string {
    const ediInput: EdiInput = {
      claimReference: data.claimReference,
      submitterName: DEFAULT_SUBMITTER_NAME,
      submitterIdentifier: DEFAULT_SUBMITTER_ID,
      receiverName: DEFAULT_RECEIVER_NAME,
      receiverIdentifier: DEFAULT_RECEIVER_ID,
      member: {
        membershipNumber: data.member?.membershipNumber ?? '',
        firstName: data.member?.firstName ?? '',
        lastName: data.member?.lastName ?? '',
        dateOfBirth: data.member?.dateOfBirth ?? '',
        address: null,
      },
      provider: {
        providerName: data.provider?.providerName ?? '',
        facilityName: data.provider?.facilityName ?? '',
        address: null,
      },
      claim: {
        totalAmount: data.totalAmount,
        currency: data.currency,
        treatmentDate: data.treatmentDate,
      },
      diagnoses: data.diagnoses,
      procedures: data.procedures,
    };

    const isInpatient =
      data.treatmentType.toUpperCase() === INPATIENT_TREATMENT_TYPE;

    const ediOutput = isInpatient
      ? this.ediGenerator.generate837I(ediInput)
      : this.ediGenerator.generate837P(ediInput);

    return ediOutput.ediContent;
  }

  /**
   * Query claims matching the batch export filter criteria.
   */
  private async queryMatchingClaims(
    input: BatchExportInput,
  ): Promise<ReadonlyArray<{ id: string; claimReference: string }>> {
    const where: Record<string, unknown> = {
      orgId: input.orgId,
    };

    if (input.claimIds && input.claimIds.length > 0) {
      where.id = { in: input.claimIds };
    }

    if (input.dateFrom || input.dateTo) {
      const createdAt: Record<string, unknown> = {};
      if (input.dateFrom) {
        createdAt.gte = new Date(input.dateFrom);
      }
      if (input.dateTo) {
        createdAt.lte = new Date(input.dateTo);
      }
      where.createdAt = createdAt;
    }

    if (input.status && input.status.length > 0) {
      where.status = { in: input.status };
    }

    if (input.planTier) {
      where.claimant = {
        path: ['planTier'],
        equals: input.planTier,
      };
    }

    const claims = await this.prisma.claim.findMany({
      where,
      select: { id: true, claimReference: true },
      orderBy: { createdAt: 'desc' },
    });

    return claims;
  }

  /**
   * Persist an EDI transaction record for a generated claim.
   */
  private async persistEdiTransaction(
    claimId: string,
    data: ClaimEdiData,
    ediContent: string,
  ): Promise<void> {
    const isInpatient =
      data.treatmentType.toUpperCase() === INPATIENT_TREATMENT_TYPE;
    const ediType = isInpatient ? '837I' : '837P';
    const controlNumber = String(Date.now() % 1_000_000_000).padStart(9, '0');

    await this.prisma.ediTransaction.create({
      data: {
        claimId,
        ediType,
        ediContent,
        controlNumber,
        status: 'GENERATED',
      },
    });
  }
}
