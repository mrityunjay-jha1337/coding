import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { MemberValidationService, MemberNotFoundError, InvalidInputError } from '../services/memberValidation.service';
import { ProviderValidationService } from '../services/providerValidation.service';
import { BupaClaimsPipeline } from '../services/bupaClaimsPipeline';
import { EdiGeneratorService } from '../services/ediGenerator.service';
import { BatchEdiExportService } from '../services/batchEdiExport.service';
import { ClaimJsonFormatterService } from '../services/claimJsonFormatter.service';
import { nanoid } from 'nanoid';

const memberService = new MemberValidationService(prisma);
const providerService = new ProviderValidationService(prisma);
const ediService = new EdiGeneratorService();
const jsonFormatter = new ClaimJsonFormatterService();

// ─── Member Endpoints ────────────────────────────────

export async function lookupMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const {
      membershipNumber,
      firstName,
      lastName,
      dateOfBirth,
    } = req.query as Record<string, string | undefined>;

    const result = await memberService.validateMember({
      membershipNumber,
      firstName,
      lastName,
      dateOfBirth,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function checkEligibility(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { memberId } = req.params;
    const { treatmentDate, treatmentCountry, treatmentType, claimAmount } = req.body;

    const result = await memberService.checkEligibility(memberId, {
      treatmentDate,
      treatmentCountry,
      treatmentType,
      claimAmount: claimAmount != null ? Number(claimAmount) : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MemberNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvalidInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function listMembers(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const status = req.query.status as string | undefined;
    const planTier = req.query.planTier as string | undefined;
    const search = req.query.search as string | undefined;

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }
    if (planTier) {
      where.planTier = planTier;
    }
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { membershipNumber: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [members, total] = await Promise.all([
      prisma.member.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { plan: { select: { name: true } } },
      }),
      prisma.member.count({ where }),
    ]);

    res.status(200).json({
      data: members,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const member = await prisma.member.findUnique({
      where: { id: req.params.id },
      include: {
        plan: true,
        paymentDetails: true,
      },
    });

    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    res.status(200).json(member);
  } catch (err) {
    next(err);
  }
}

export async function createMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const member = await memberService.createMember(req.body);
    res.status(201).json(member);
  } catch (err) {
    if (err instanceof InvalidInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ─── Provider Endpoints ──────────────────────────────

export async function lookupProvider(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const {
      facilityName,
      practitionerName,
      country,
      bupaProviderId,
      planTier,
    } = req.query as Record<string, string | undefined>;

    const result = await providerService.validateProvider(
      {
        facilityName,
        practitionerName,
        address: country ? { country } : undefined,
        bupaProviderId,
      },
      planTier ?? 'PREMIER',
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listProviders(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const networkStatus = req.query.networkStatus as string | undefined;
    const country = req.query.country as string | undefined;
    const providerType = req.query.providerType as string | undefined;
    const search = req.query.search as string | undefined;

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (networkStatus) {
      where.networkStatus = networkStatus;
    }
    if (country) {
      where.country = country;
    }
    if (providerType) {
      where.providerType = providerType;
    }
    if (search) {
      where.OR = [
        { providerName: { contains: search, mode: 'insensitive' } },
        { facilityName: { contains: search, mode: 'insensitive' } },
        { bupaProviderId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [providers, total] = await Promise.all([
      prisma.provider.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.provider.count({ where }),
    ]);

    res.status(200).json({
      data: providers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getProvider(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const provider = await prisma.provider.findUnique({
      where: { id: req.params.id },
      include: {
        networkMappings: true,
      },
    });

    if (!provider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    res.status(200).json(provider);
  } catch (err) {
    next(err);
  }
}

// ─── Plan Endpoints ──────────────────────────────────

export async function listPlans(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const plans = await prisma.healthPlan.findMany({
      orderBy: { tier: 'asc' },
      include: {
        members: { select: { id: true } },
      },
    });

    const plansWithBenefits = plans.map((plan) => ({
      ...plan,
      memberCount: plan.members.length,
      members: undefined,
    }));

    res.status(200).json(plansWithBenefits);
  } catch (err) {
    next(err);
  }
}

export async function getPlan(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const plan = await prisma.healthPlan.findUnique({
      where: { id: req.params.id },
      include: {
        members: { select: { id: true } },
      },
    });

    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    res.status(200).json({
      ...plan,
      memberCount: plan.members.length,
      members: undefined,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Bupa Pipeline Endpoint ──────────────────────────

export async function processBupaClaim(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const {
      filePath,
      membershipNumber,
      claimantName,
      claimantDob,
      facilityName,
      practitionerName,
      treatmentCountry,
      treatmentDate,
      treatmentType,
      claimAmount,
      currency,
    } = req.body;

    // Generate a claim reference
    const year = new Date().getFullYear();
    const seq = nanoid(5).toUpperCase();
    const claimReference = `BG-${year}-${seq}`;

    // Create or find the claim record first
    const claim = await prisma.claim.create({
      data: {
        orgId: req.user.orgId,
        claimReference,
        status: 'INGESTING',
        priority: 50,
      },
    });

    const pipeline = new BupaClaimsPipeline(prisma);

    const pipelineResult = await pipeline.processClaim({
      filePath,
      claimId: claim.id,
      membershipNumber,
      claimantName,
      claimantDob,
      facilityName,
      practitionerName,
      treatmentCountry,
      treatmentDate,
      treatmentType,
      claimAmount: claimAmount != null ? Number(claimAmount) : undefined,
      currency,
    });

    // Persist results to DB in a transaction
    await prisma.$transaction(async (tx) => {
      // Determine claim status from adjudication decision
      const adjudicationDecision = pipelineResult.adjudication?.decision;
      let claimStatus: string;
      if (adjudicationDecision === 'DENIED') {
        claimStatus = 'CLOSED';
      } else if (pipelineResult.requiresHumanReview) {
        claimStatus = 'REVIEWING';
      } else if (pipelineResult.stage === 'COMPLETE') {
        claimStatus = 'COMPLETE';
      } else {
        claimStatus = 'VALIDATING';
      }

      // Update the claim record with pipeline results
      await tx.claim.update({
        where: { id: claim.id },
        data: {
          status: claimStatus as any,
          claimant: pipelineResult.memberValidation?.member
            ? {
                name: pipelineResult.memberValidation.member.fullName,
                membershipNumber: pipelineResult.memberValidation.member.membershipNumber,
                dateOfBirth: pipelineResult.memberValidation.member.dateOfBirth,
              }
            : (() => {
                // Fall back through: caller-supplied name → name extracted from
                // the uploaded claim file (PDF). Only use 'Unknown' if no source
                // produced a name at all.
                const extracted = pipelineResult.extractedPatient;
                const resolvedName =
                  claimantName ?? extracted?.name ?? null;
                return {
                  name: resolvedName ?? 'Unknown',
                  firstName: extracted?.firstName ?? null,
                  lastName: extracted?.lastName ?? null,
                  dateOfBirth: extracted?.dateOfBirth ?? null,
                  membershipNumber: extracted?.membershipNumber ?? membershipNumber ?? null,
                  email: extracted?.email ?? null,
                  telephone: extracted?.telephone ?? null,
                };
              })(),
          policy: pipelineResult.memberValidation?.member
            ? {
                planTier: pipelineResult.memberValidation.member.planTier,
                planName: pipelineResult.memberValidation.member.planName,
                policyStatus: pipelineResult.memberValidation.member.policyStatus,
                policyStartDate: pipelineResult.memberValidation.member.policyStartDate,
                policyEndDate: pipelineResult.memberValidation.member.policyEndDate,
              }
            : Prisma.DbNull,
          treatment: {
            country: treatmentCountry ?? null,
            treatmentType: treatmentType ?? null,
            treatmentDate: treatmentDate ?? null,
            facilityName: facilityName ?? null,
            practitionerName: practitionerName ?? null,
          },
          financials: {
            currency: currency ?? pipelineResult.extractedFinancials?.currency ?? 'USD',
            totalClaimed: claimAmount != null ? Number(claimAmount) : (pipelineResult.extractedFinancials?.amount ?? 0),
            totalPayable: pipelineResult.coverageAnalysis?.totalPayable ?? 0,
            deductibleApplied: pipelineResult.coverageAnalysis?.totalDeductible ?? 0,
            coInsuranceApplied: pipelineResult.coverageAnalysis?.totalCoInsurance ?? 0,
            networkPenalty: pipelineResult.coverageAnalysis?.totalNetworkPenalty ?? 0,
            itemisedCharges: pipelineResult.extractedFinancials?.itemisedCharges ?? [],
          },
          coverageAnalysis: pipelineResult.coverageAnalysis ?? Prisma.DbNull,
          processingTimeMs: pipelineResult.processingTimeMs,
          // Stored on a 0–100 percentage scale. finalCodes[].confidence is
          // already on a 0–100 scale from the reconciliation service.
          overallConfidence: pipelineResult.pipeline?.reconciliation?.finalCodes?.length > 0
            ? (pipelineResult.pipeline.reconciliation.finalCodes.reduce(
                (acc: number, c: any) => acc + c.confidence, 0,
              ) / pipelineResult.pipeline.reconciliation.finalCodes.length)
            : null,
          errors: pipelineResult.errors as string[],
          completedAt: claimStatus === 'COMPLETE' || claimStatus === 'CLOSED' ? new Date() : null,
        },
      });

      // Create MemberClaim link if member was found
      if (pipelineResult.memberValidation?.member?.id) {
        await tx.memberClaim.upsert({
          where: {
            memberId_claimId: {
              memberId: pipelineResult.memberValidation.member.id,
              claimId: claim.id,
            },
          },
          create: {
            memberId: pipelineResult.memberValidation.member.id,
            claimId: claim.id,
          },
          update: {},
        });
      }

      // Create ProviderClaim link if provider was found
      if (pipelineResult.providerValidation?.provider?.id) {
        await tx.providerClaim.upsert({
          where: {
            providerId_claimId: {
              providerId: pipelineResult.providerValidation.provider.id,
              claimId: claim.id,
            },
          },
          create: {
            providerId: pipelineResult.providerValidation.provider.id,
            claimId: claim.id,
          },
          update: {},
        });
      }

      // Create CoverageDecision records from coverage analysis line items
      if (pipelineResult.coverageAnalysis?.lineItemDecisions) {
        const decisions = pipelineResult.coverageAnalysis.lineItemDecisions as ReadonlyArray<{
          index: number;
          description: string;
          amountClaimed: number;
          isCovered: boolean;
          benefitCategory: string;
          benefitLimit: number | null;
          amountPayable: number;
          deductibleApplied: number;
          coInsuranceApplied: number;
          networkPenalty: number;
          denialReason: string | null;
        }>;

        for (const decision of decisions) {
          await tx.coverageDecision.create({
            data: {
              claimId: claim.id,
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
      }

      // Create EdiTransaction if EDI was generated
      if (pipelineResult.edi?.ediContent) {
        await tx.ediTransaction.create({
          data: {
            claimId: claim.id,
            ediType: pipelineResult.edi.ediType,
            ediContent: pipelineResult.edi.ediContent,
            controlNumber: pipelineResult.edi.controlNumber,
            status: 'GENERATED',
          },
        });
      }
    });

    res.status(200).json({
      claimId: claim.id,
      claimReference,
      ...pipelineResult,
    });
  } catch (err) {
    next(err);
  }
}

// ─── EDI / JSON Export Endpoints ─────────────────────

export async function getClaimEdi(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const claimId = req.params.id;

    // Look up existing EDI transaction
    const ediTransaction = await prisma.ediTransaction.findFirst({
      where: { claimId },
      orderBy: { generatedAt: 'desc' },
    });

    if (ediTransaction) {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="edi-${claimId}.edi"`,
      );
      res.status(200).send(ediTransaction.ediContent);
      return;
    }

    // If not found, generate on-the-fly
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const claimant = claim.claimant as Record<string, unknown> | null;
    const financials = claim.financials as Record<string, unknown> | null;
    const treatment = claim.treatment as Record<string, unknown> | null;

    const memberClaim = await prisma.memberClaim.findFirst({
      where: { claimId },
    });

    let memberData: Record<string, unknown> = {};
    if (memberClaim) {
      const member = await prisma.member.findUnique({
        where: { id: memberClaim.memberId },
      });
      if (member) {
        memberData = {
          membershipNumber: member.membershipNumber,
          firstName: member.firstName,
          lastName: member.lastName,
          dateOfBirth: member.dateOfBirth.toISOString().split('T')[0],
          address: member.address,
        };
      }
    }

    const providerClaim = await prisma.providerClaim.findFirst({
      where: { claimId },
    });

    let providerData: Record<string, unknown> = {};
    if (providerClaim) {
      const provider = await prisma.provider.findUnique({
        where: { id: providerClaim.providerId },
      });
      if (provider) {
        providerData = {
          providerName: provider.providerName,
          facilityName: provider.facilityName ?? '',
          address: provider.address,
        };
      }
    }

    // Gather coding for diagnoses
    const codings = await prisma.claimCoding.findMany({
      where: { claimId },
      orderBy: { isPrimary: 'desc' },
    });

    const diagnoses = codings.map((c) => ({
      code: c.code,
      isPrimary: c.isPrimary,
    }));

    const ediOutput = ediService.generate837P({
      claimReference: claim.claimReference,
      submitterName: 'BUPA GLOBAL',
      submitterIdentifier: 'BUPAGLOBAL',
      receiverName: 'CLEARINGHOUSE',
      receiverIdentifier: 'CLEARINGHS',
      member: {
        membershipNumber: (memberData.membershipNumber as string) ?? '',
        firstName: (memberData.firstName as string) ?? '',
        lastName: (memberData.lastName as string) ?? '',
        dateOfBirth: (memberData.dateOfBirth as string) ?? '',
        address: (memberData.address as any) ?? null,
      },
      provider: {
        providerName: (providerData.providerName as string) ?? '',
        facilityName: (providerData.facilityName as string) ?? '',
        address: (providerData.address as any) ?? null,
      },
      claim: {
        totalAmount: (financials?.totalClaimed as number) ?? 0,
        currency: (financials?.currency as string) ?? 'USD',
        treatmentDate: (treatment?.treatmentDate as string) ?? new Date().toISOString().split('T')[0],
      },
      diagnoses,
      procedures: [],
    });

    // Persist the generated EDI
    await prisma.ediTransaction.create({
      data: {
        claimId,
        ediType: ediOutput.ediType,
        ediContent: ediOutput.ediContent,
        controlNumber: ediOutput.controlNumber,
        status: 'GENERATED',
      },
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="edi-${claimId}.edi"`,
    );
    res.status(200).send(ediOutput.ediContent);
  } catch (err) {
    next(err);
  }
}

export async function getClaimExportJson(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const claimId = req.params.id;

    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const claimant = claim.claimant as Record<string, unknown> | null;
    const financials = claim.financials as Record<string, unknown> | null;
    const treatment = claim.treatment as Record<string, unknown> | null;
    const coverageAnalysisData = claim.coverageAnalysis as Record<string, unknown> | null;

    // Fetch member data
    const memberClaim = await prisma.memberClaim.findFirst({
      where: { claimId },
    });

    let memberRecord: unknown = null;
    if (memberClaim) {
      const member = await prisma.member.findUnique({
        where: { id: memberClaim.memberId },
        include: { plan: { select: { name: true } } },
      });
      if (member) {
        memberRecord = {
          id: member.id,
          membershipNumber: member.membershipNumber,
          fullName: `${member.firstName} ${member.lastName}`,
          dateOfBirth: member.dateOfBirth.toISOString().split('T')[0],
          planTier: member.planTier,
          planName: member.plan.name,
        };
      }
    }

    // Fetch provider data
    const providerClaim = await prisma.providerClaim.findFirst({
      where: { claimId },
    });

    let providerRecord: unknown = null;
    if (providerClaim) {
      const provider = await prisma.provider.findUnique({
        where: { id: providerClaim.providerId },
      });
      if (provider) {
        providerRecord = {
          id: provider.id,
          providerName: provider.providerName,
          facilityName: provider.facilityName,
          providerType: provider.providerType,
          country: provider.country,
          networkStatus: provider.networkStatus,
        };
      }
    }

    // Fetch codings
    const codings = await prisma.claimCoding.findMany({
      where: { claimId },
      orderBy: { isPrimary: 'desc' },
    });

    // Fetch coverage decisions
    const coverageDecisions = await prisma.coverageDecision.findMany({
      where: { claimId },
      orderBy: { lineItemIndex: 'asc' },
    });

    // Fetch documents
    const documents = await prisma.claimDocument.findMany({
      where: { claimId },
      select: { id: true, originalFilename: true, mimeType: true, docType: true, createdAt: true },
    });

    // Fetch audit events
    const auditEvents = await prisma.auditEvent.findMany({
      where: { targetId: claimId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const claimJson = jsonFormatter.formatClaimJson({
      claimReference: claim.claimReference,
      member: memberRecord,
      provider: providerRecord,
      treatment: {
        country: (treatment?.country as string) ?? 'Unknown',
        treatmentType: (treatment?.treatmentType as string) ?? 'OUTPATIENT',
        primaryDiagnosis: codings.length > 0
          ? { code: codings[0].code, description: codings[0].description }
          : null,
        procedures: [],
        medications: [],
      },
      financials: {
        currency: (financials?.currency as string) ?? 'USD',
        totalClaimed: (financials?.totalClaimed as number) ?? 0,
        deductibleApplied: (financials?.deductibleApplied as number) ?? 0,
        coInsuranceApplied: (financials?.coInsuranceApplied as number) ?? 0,
        networkPenalty: (financials?.networkPenalty as number) ?? 0,
        totalPayable: (financials?.totalPayable as number) ?? 0,
        lineItems: coverageDecisions.map((d) => ({
          index: d.lineItemIndex,
          benefitName: d.benefitName,
          isCovered: d.isCovered,
          amountClaimed: d.amountClaimed,
          amountPayable: d.amountPayable,
          deductibleApplied: d.deductibleApplied,
          coInsuranceApplied: d.coInsuranceApplied,
          networkPenalty: d.networkPenalty,
          denialReason: d.denialReason,
        })),
      },
      payment: null,
      decision: {
        status: claim.status,
        reason: claim.errors.length > 0 ? claim.errors.join('; ') : 'Processed',
        adjudicatedBy: 'SYSTEM',
        adjudicatedAt: claim.completedAt?.toISOString() ?? claim.updatedAt.toISOString(),
        humanReviewRequired: claim.status === 'REVIEWING',
      },
      coding: {
        icd10: codings
          .filter((c) => c.codeType === 'ICD10')
          .map((c) => ({
            code: c.code,
            description: c.description,
            type: c.isPrimary ? 'PRIMARY' : 'SECONDARY',
            confidence: Math.round(c.confidence * 100),
            validated: c.isValidated,
          })),
        cpt: codings
          .filter((c) => c.codeType === 'CPT')
          .map((c) => ({
            code: c.code,
            description: c.description,
            confidence: Math.round(c.confidence * 100),
          })),
      },
      coverageAnalysis: coverageAnalysisData,
      documents: documents.map((d) => ({
        id: d.id,
        filename: d.originalFilename,
        mimeType: d.mimeType,
        docType: d.docType,
        createdAt: d.createdAt.toISOString(),
      })),
      auditTrail: auditEvents.map((e) => ({
        timestamp: e.createdAt.toISOString(),
        event: e.eventType,
        actor: e.actorType,
        action: e.action,
      })),
    });

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(claimJson);
  } catch (err) {
    next(err);
  }
}

// ─── Batch EDI Export Endpoint ──────────────────────

export async function batchExportEdi(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { dateFrom, dateTo, status, planTier, claimIds, format } = req.body;

    const exportService = new BatchEdiExportService(prisma);
    const result = await exportService.exportBatch({
      orgId: req.user.orgId,
      dateFrom,
      dateTo,
      status,
      planTier,
      claimIds,
      format: format || 'COMBINED',
    });

    if (result.contentType === 'text/plain') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.status(200).send(result.content);
    } else {
      res.status(200).json(result);
    }
  } catch (err) {
    next(err);
  }
}
