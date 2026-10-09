/**
 * Bupa Global Agentic Claims Pipeline
 *
 * Orchestrates the full BG STP flow:
 *   Intake → Legibility → Language → Member Validation → Eligibility →
 *   Provider Validation → Completeness → Duplicate Check → ICD/CPT Coding →
 *   Clinical Validation → Coverage Analysis → Adjudication → EDI/JSON → Complete
 *
 * Each step evaluates confidence and may escalate to human review.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { parsePdf } from './pdfParserService';
import { detectLanguage } from './languageDetectionService';
import { translateMedicalText } from './translationService';
import { extractICDCodes } from './icdCodingService';
import { reconcileResults } from './reconciliationService';
import { MemberValidationService } from './memberValidation.service';
import { ProviderValidationService } from './providerValidation.service';
import { CompletenessCheckService } from './completenessCheck.service';
import { CoverageAnalysisService } from './coverageAnalysis.service';
import { AdjudicationService } from './adjudication.service';
import { EdiGeneratorService } from './ediGenerator.service';
import { ClaimJsonFormatterService } from './claimJsonFormatter.service';
import { ClinicalValidationService } from './clinicalValidation.service';
import { DuplicateDetectionService } from './duplicateDetection.service';
import { PaymentCalculationService } from './paymentCalculation.service';
import { BupaCorrespondenceService } from './bupaCorrespondence.service';
import { PreAuthorizationService } from './preAuthorization.service';
import { AuditService } from './audit.service';
import { BupaClaimFormExtractorService } from './bupaClaimFormExtractor.service';
import { extractOPCS4Codes } from './opcs4Coding.service';
import type { BupaClaimFormData } from './completenessCheck.service';
import type { ClaimLineItem } from './coverageAnalysis.service';
import type { PipelineResult } from '../../shared/types';

// ─── Types ────────────────────────────────────────────

export type BupaPipelineStage =
  | 'INTAKE'
  | 'LEGIBILITY'
  | 'LANGUAGE_DETECTION'
  | 'TRANSLATION'
  | 'MEMBER_VALIDATION'
  | 'ELIGIBILITY_CHECK'
  | 'PROVIDER_VALIDATION'
  | 'COMPLETENESS_CHECK'
  | 'DUPLICATE_CHECK'
  | 'MEDICAL_CODING'
  | 'CLINICAL_VALIDATION'
  | 'COVERAGE_ANALYSIS'
  | 'ADJUDICATION'
  | 'EDI_GENERATION'
  | 'JSON_GENERATION'
  | 'COMPLETE'
  | 'QUERYING_MEMBER'
  | 'QUERYING_PROVIDER'
  | 'ESCALATED_HANDLER'
  | 'ESCALATED_CLINICAL'
  | 'ESCALATED_TEAM_LEAD'
  | 'DENIED';

export interface BupaPipelineInput {
  readonly filePath: string;
  readonly claimId?: string;
  readonly membershipNumber?: string;
  readonly claimantName?: string;
  readonly claimantDob?: string;
  readonly facilityName?: string;
  readonly practitionerName?: string;
  readonly treatmentCountry?: string;
  readonly treatmentDate?: string;
  readonly treatmentType?: string;
  readonly claimAmount?: number;
  readonly currency?: string;
  readonly highValueThreshold?: number;
}

export interface BupaPipelineResult {
  readonly claimId?: string;
  readonly claimReference?: string;
  readonly stage: BupaPipelineStage;
  readonly pipeline: PipelineResult;
  readonly memberValidation: any;
  readonly eligibility: any;
  readonly providerValidation: any;
  readonly completeness: any;
  readonly coverageAnalysis: any;
  readonly adjudication: any;
  readonly clinicalValidation: any;
  readonly duplicateCheck: any;
  readonly paymentCalculation: any;
  readonly edi: any;
  readonly claimJson: any;
  readonly extractedFinancials?: {
    readonly amount: number | null;
    readonly currency: string | null;
    readonly itemisedCharges: ReadonlyArray<{ description: string; amount: number }> | null;
  };
  readonly extractedPatient?: {
    readonly name: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly dateOfBirth: string | null;
    readonly membershipNumber: string | null;
    readonly email: string | null;
    readonly telephone: string | null;
  };
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly processingTimeMs: number;
  readonly requiresHumanReview: boolean;
  readonly humanReviewReason: string | null;
}

interface StageResult {
  stage: BupaPipelineStage;
  proceed: boolean;
  data: any;
  error?: string;
}

// ─── Constants ────────────────────────────────────────

const LEGIBILITY_AUTO_THRESHOLD = 70;
const LEGIBILITY_WARN_THRESHOLD = 45;
const TRANSLATION_AUTO_THRESHOLD = 65;
const CODING_AUTO_THRESHOLD = 80;
const CODING_ESCALATE_THRESHOLD = 60;
const CLINICAL_AUTO_THRESHOLD = 70;
const COMPLETENESS_AUTO_THRESHOLD = 70;
const COMPLETENESS_QUERY_THRESHOLD = 50;
const HIGH_VALUE_DEFAULT = 50000;

// ─── Pipeline Orchestrator ────────────────────────────

export class BupaClaimsPipeline {
  private readonly memberService: MemberValidationService;
  private readonly providerService: ProviderValidationService;
  private readonly completenessService: CompletenessCheckService;
  private readonly coverageService: CoverageAnalysisService;
  private readonly adjudicationService: AdjudicationService;
  private readonly ediService: EdiGeneratorService;
  private readonly jsonFormatter: ClaimJsonFormatterService;
  private readonly clinicalService: ClinicalValidationService;
  private readonly duplicateService: DuplicateDetectionService;
  private readonly paymentService: PaymentCalculationService;
  private readonly bupaCorrespondenceService: BupaCorrespondenceService;
  private readonly preAuthService: PreAuthorizationService;
  private readonly auditService: AuditService;
  private readonly formExtractor: BupaClaimFormExtractorService;

  constructor(private readonly prisma: PrismaClient) {
    this.memberService = new MemberValidationService(prisma);
    this.providerService = new ProviderValidationService(prisma);
    this.completenessService = new CompletenessCheckService();
    this.coverageService = new CoverageAnalysisService();
    this.adjudicationService = new AdjudicationService();
    this.ediService = new EdiGeneratorService();
    this.jsonFormatter = new ClaimJsonFormatterService();
    this.clinicalService = new ClinicalValidationService();
    this.duplicateService = new DuplicateDetectionService(prisma);
    this.paymentService = new PaymentCalculationService();
    this.bupaCorrespondenceService = new BupaCorrespondenceService(prisma);
    this.preAuthService = new PreAuthorizationService(prisma);
    this.auditService = new AuditService(prisma);
    this.formExtractor = new BupaClaimFormExtractorService();
  }

  /**
   * Run the full Bupa Global claims processing pipeline.
   * At each stage, evaluate whether to proceed, query, or escalate.
   */
  async processClaim(input: BupaPipelineInput): Promise<BupaPipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    let currentStage: BupaPipelineStage = 'INTAKE';
    let requiresHumanReview = false;
    let humanReviewReason: string | null = null;

    // Accumulate results from each stage
    let pipelineResult: PipelineResult | null = null;
    let memberValidation: any = null;
    let eligibility: any = null;
    let providerValidation: any = null;
    let completeness: any = null;
    let coverageAnalysis: any = null;
    let adjudication: any = null;
    let clinicalValidation: any = null;
    let duplicateCheck: any = null;
    let paymentCalculation: any = null;
    let edi: any = null;
    let claimJson: any = null;
    let extractedFormData: BupaClaimFormData | null = null;
    let effectiveClaimAmount: number | undefined = undefined;
    let effectiveCurrency: string | undefined = undefined;


    const highValueThreshold = input.highValueThreshold ?? HIGH_VALUE_DEFAULT;

    try {
      // ══════════════════════════════════════════════════
      // STAGE 1: DOCUMENT EXTRACTION & LEGIBILITY
      // ══════════════════════════════════════════════════
      currentStage = 'LEGIBILITY';
      logger.info(`[BupaPipeline] Stage 1: Document extraction & legibility check`);

      const extraction = await parsePdf(input.filePath);
      const legibilityScore = extraction.fullText.trim().length > 0 ? 85 : 0; // Simplified

      // Extract structured Bupa claim form fields from the PDF text. The
      // extractor returns a fully-shaped BupaClaimFormData object (with
      // nulls for any fields the LLM could not locate), which is then used
      // to fill downstream stages — particularly financials (claim amount
      // and currency) which otherwise rely on caller-supplied input.
      try {
        extractedFormData = await this.formExtractor.extractFromPdfResult(extraction);
      } catch (formError: any) {
        warnings.push(`Bupa form extraction failed: ${formError.message}. Using caller-provided values.`);
      }

      const extractedAmount = extractedFormData?.medicalDetails?.totalClaimedAmount ?? null;
      const extractedCurrency = extractedFormData?.medicalDetails?.invoiceCurrency ?? null;
      effectiveClaimAmount = input.claimAmount ?? extractedAmount ?? undefined;
      effectiveCurrency = input.currency ?? extractedCurrency ?? undefined;


      if (legibilityScore < LEGIBILITY_WARN_THRESHOLD) {
        currentStage = 'ESCALATED_HANDLER';
        requiresHumanReview = true;
        humanReviewReason = `Document legibility score (${legibilityScore}%) below threshold. Manual review required.`;
        warnings.push(humanReviewReason);
      } else if (legibilityScore < LEGIBILITY_AUTO_THRESHOLD) {
        warnings.push(`Document legibility score (${legibilityScore}%) is moderate. Flagged for review.`);
      }

      // ══════════════════════════════════════════════════
      // STAGE 2: LANGUAGE DETECTION
      // ══════════════════════════════════════════════════
      currentStage = 'LANGUAGE_DETECTION';
      logger.info(`[BupaPipeline] Stage 2: Language detection`);

      const languageDetection = detectLanguage(extraction.fullText);
      const detectedLang = languageDetection.specificLanguage || languageDetection.language;

      // ══════════════════════════════════════════════════
      // STAGE 3: TRANSLATION (if needed)
      // ══════════════════════════════════════════════════
      let translation = null;
      let englishText = extraction.fullText;
      const needsTranslation = languageDetection.language !== 'english';

      if (needsTranslation) {
        currentStage = 'TRANSLATION';
        logger.info(`[BupaPipeline] Stage 3: Translating from ${detectedLang} to English`);

        try {
          translation = await translateMedicalText(extraction.fullText, detectedLang);
          if (translation.translatedText.trim()) {
            englishText = translation.translatedText;
          } else {
            warnings.push('Translation returned empty text. Using original text.');
          }
        } catch (error: any) {
          errors.push(`Translation failed: ${error.message}`);
          warnings.push('Proceeding with original text for coding.');
        }
      }

      // ══════════════════════════════════════════════════
      // STAGE 4: MEMBER VALIDATION
      // ══════════════════════════════════════════════════
      currentStage = 'MEMBER_VALIDATION';
      logger.info(`[BupaPipeline] Stage 4: Member validation`);

      try {
        memberValidation = await this.memberService.validateMember({
          membershipNumber: input.membershipNumber,
          firstName: input.claimantName?.split(' ')[0],
          lastName: input.claimantName?.split(' ').slice(1).join(' '),
          dateOfBirth: input.claimantDob,
        });

        if (!memberValidation.isValid) {
          const failedChecks = memberValidation.checks
            .filter((c: any) => c.status === 'fail')
            .map((c: any) => c.message);
          warnings.push(...failedChecks);

          if (!memberValidation.member) {
            currentStage = 'QUERYING_MEMBER';
            warnings.push('Member not found. Query sent for correct membership number.');
          }
        }
      } catch (error: any) {
        errors.push(`Member validation failed: ${error.message}`);
        warnings.push('Member validation skipped due to error. Proceeding with caution.');
      }

      // ══════════════════════════════════════════════════
      // STAGE 5: ELIGIBILITY CHECK
      // ══════════════════════════════════════════════════
      if (memberValidation?.member) {
        currentStage = 'ELIGIBILITY_CHECK';
        logger.info(`[BupaPipeline] Stage 5: Eligibility check`);

        try {
          eligibility = await this.memberService.checkEligibility(
            memberValidation.member.id,
            {
              treatmentDate: input.treatmentDate ?? new Date().toISOString().split('T')[0],
              treatmentCountry: input.treatmentCountry ?? 'HK',
              treatmentType: input.treatmentType,
              claimAmount: effectiveClaimAmount,
            }
          );

          if (!eligibility.isEligible) {
            currentStage = 'DENIED';
            errors.push(`Eligibility check failed: ${eligibility.reason}`);
          }
        } catch (error: any) {
          errors.push(`Eligibility check failed: ${error.message}`);
          warnings.push('Eligibility check skipped. Flagged for human review.');
          requiresHumanReview = true;
          humanReviewReason = 'Eligibility check could not be completed automatically.';
        }
      }

      // ══════════════════════════════════════════════════
      // STAGE 5b: PRE-AUTHORIZATION CHECK
      // ══════════════════════════════════════════════════
      if (eligibility?.preAuthRequired && memberValidation?.member?.id) {
        logger.info(`[BupaPipeline] Stage 5b: Pre-authorization check`);
        try {
          const preAuthResult = await this.preAuthService.checkPreAuth({
            memberId: memberValidation.member.id,
            treatmentType: input.treatmentType ?? 'OUTPATIENT',
            treatmentDate: input.treatmentDate ?? new Date().toISOString(),
          });

          if (!preAuthResult.isValid) {
            // Create pre-auth request
            await this.preAuthService.requestPreAuth({
              memberId: memberValidation.member.id,
              claimId: input.claimId,
              treatmentType: input.treatmentType ?? 'INPATIENT',
              treatmentDate: input.treatmentDate ?? new Date().toISOString(),
              requestedBy: 'SYSTEM',
            });

            // Send reminder correspondence if member email available
            const memberEmail = memberValidation.member?.email;
            if (memberEmail && input.claimId) {
              await this.bupaCorrespondenceService.sendAndRecord({
                claimId: input.claimId,
                claimReference: input.claimId,
                correspondenceType: 'PRE_AUTH_REMINDER',
                recipientEmail: memberEmail,
                recipientName: memberValidation.member?.fullName ?? 'Member',
                recipientLanguage: 'en',
              });
            }

            currentStage = 'QUERYING_MEMBER';
            warnings.push(preAuthResult.reason);
          }
        } catch (error: any) {
          warnings.push(`Pre-authorization check failed: ${error.message}`);
        }
      }

      // ══════════════════════════════════════════════════
      // STAGE 6: PROVIDER VALIDATION
      // ══════════════════════════════════════════════════
      currentStage = 'PROVIDER_VALIDATION';
      logger.info(`[BupaPipeline] Stage 6: Provider validation`);

      try {
        const planTier = memberValidation?.member?.planTier ?? 'PREMIER';
        providerValidation = await this.providerService.validateProvider(
          {
            facilityName: input.facilityName,
            practitionerName: input.practitionerName,
            address: { country: input.treatmentCountry },
          },
          planTier
        );

        if (providerValidation.isNewProvider) {
          warnings.push('Provider not found in database. Provisional record created.');
        }
      } catch (error: any) {
        errors.push(`Provider validation failed: ${error.message}`);
      }

      // ══════════════════════════════════════════════════
      // STAGE 7: COMPLETENESS CHECK
      // ══════════════════════════════════════════════════
      currentStage = 'COMPLETENESS_CHECK';
      logger.info(`[BupaPipeline] Stage 7: Completeness check`);

      const claimFormData: BupaClaimFormData = {
        patientDetails: {
          membershipNumber: input.membershipNumber ?? null,
          groupName: null,
          title: null,
          firstName: input.claimantName?.split(' ')[0] ?? null,
          lastName: input.claimantName?.split(' ').slice(1).join(' ') ?? null,
          dateOfBirth: input.claimantDob ?? null,
          address: null,
          email: memberValidation?.member?.email ?? null,
          telephone: memberValidation?.member?.phone ?? null,
        },
        medicalDetails: {
          treatmentCountry: input.treatmentCountry ?? extractedFormData?.medicalDetails?.treatmentCountry ?? null,
          invoiceCurrency: effectiveCurrency ?? null,
          totalClaimedAmount: effectiveClaimAmount ?? null,
          reasonForTreatment: extractedFormData?.medicalDetails?.reasonForTreatment ?? null,
          treatmentType: input.treatmentType ?? extractedFormData?.medicalDetails?.treatmentType ?? null,
          symptomStartDate: extractedFormData?.medicalDetails?.symptomStartDate ?? null,
          treatmentDate: input.treatmentDate ?? extractedFormData?.medicalDetails?.treatmentDate ?? null,
          treatmentDescription: extractedFormData?.medicalDetails?.treatmentDescription ?? null,
          practitionerName: input.practitionerName ?? extractedFormData?.medicalDetails?.practitionerName ?? null,
          practitionerSpecialty: extractedFormData?.medicalDetails?.practitionerSpecialty ?? null,
          facilityName: input.facilityName ?? extractedFormData?.medicalDetails?.facilityName ?? null,
          facilityAddress: extractedFormData?.medicalDetails?.facilityAddress ?? null,
          admissionDate: extractedFormData?.medicalDetails?.admissionDate ?? null,
          dischargeDate: extractedFormData?.medicalDetails?.dischargeDate ?? null,
          surgeryDate: extractedFormData?.medicalDetails?.surgeryDate ?? null,
          hospitalName: input.facilityName ?? extractedFormData?.medicalDetails?.hospitalName ?? null,
          itemisedCharges: extractedFormData?.medicalDetails?.itemisedCharges ?? null,
        },

        cashBenefit: {
          applicable: null,
          hospitalStayFrom: null,
          hospitalStayTo: null,
          hospitalStampVerified: null,
        },
        paymentDetails: {
          payeeType: null,
          bankName: null,
          swiftCode: null,
          accountNumber: null,
          sortCode: null,
          iban: null,
          accountHolderName: null,
          accountCurrency: null,
          chequeCurrencyPreference: null,
        },
        thirdParty: {
          applicable: null,
          name: null,
          contact: null,
        },
        consent: {
          consentGiven: null,
          reportViewPreference: null,
        },
        declaration: {
          signaturePresent: null,
          signatureDate: null,
          printName: null,
        },
      };

      completeness = this.completenessService.checkCompleteness(claimFormData);


      if (completeness.score < COMPLETENESS_QUERY_THRESHOLD) {
        requiresHumanReview = true;
        humanReviewReason = `Completeness score (${completeness.score}%) too low for auto-processing.`;
      } else if (completeness.score < COMPLETENESS_AUTO_THRESHOLD) {
        const { memberQuery, providerQuery } = this.completenessService.generateMissingInfoQuery(completeness.missingFields);
        if (memberQuery.length > 0) {
          warnings.push(`Missing member info: ${memberQuery.map(f => f.fieldLabel).join(', ')}`);
        }
        if (providerQuery.length > 0) {
          warnings.push(`Missing provider info: ${providerQuery.map(f => f.fieldLabel).join(', ')}`);
        }

        // ── Auto-trigger correspondence for missing info ──
        const memberEmail = memberValidation?.member?.email ?? null;
        const memberName = memberValidation?.member?.fullName ?? null;
        const providerEmail = providerValidation?.provider?.email ?? null;
        const providerName = providerValidation?.provider?.providerName ?? null;

        try {
          // Send to member if fields are missing and we have an email
          if (memberQuery.length > 0 && memberEmail && input.claimId) {
            const hasBankFields = memberQuery.some((f) => f.section === 'paymentDetails');
            const correspondenceType = hasBankFields ? 'BANK_DETAILS_REQUEST' : 'MISSING_INFO_REQUEST';

            await this.bupaCorrespondenceService.sendAndRecord({
              claimId: input.claimId,
              claimReference: input.claimId,
              correspondenceType,
              recipientEmail: memberEmail,
              recipientName: memberName ?? 'Member',
              recipientLanguage: 'en',
              missingFields: memberQuery.map((f) => f.fieldLabel),
            });
            warnings.push('Auto-sent missing info request to member');
          }

          // Send to provider if clinical/medical fields are missing
          if (providerQuery.length > 0 && providerEmail && input.claimId) {
            await this.bupaCorrespondenceService.sendAndRecord({
              claimId: input.claimId,
              claimReference: input.claimId,
              correspondenceType: 'MEDICAL_QUERY',
              recipientEmail: providerEmail,
              recipientName: providerName ?? 'Provider',
              recipientLanguage: 'en',
              missingFields: providerQuery.map((f) => f.fieldLabel),
            });
            warnings.push('Auto-sent medical query to provider');
          }

          // If critical fields missing, halt pipeline and audit the hold
          const criticalMissing = completeness.missingFields.filter((f: any) => f.severity === 'critical');
          if (criticalMissing.length > 0 && input.claimId) {
            if (memberQuery.length > 0) {
              currentStage = 'QUERYING_MEMBER';
            } else if (providerQuery.length > 0) {
              currentStage = 'QUERYING_PROVIDER';
            }

            const priorClaim = await this.prisma.claim.findUnique({
              where: { id: input.claimId },
              select: { status: true },
            });

            await this.prisma.claim.update({
              where: { id: input.claimId },
              data: { status: 'ON_HOLD' },
            });

            const missingFieldLabels = criticalMissing.map((f: any) => f.fieldLabel);
            const missingFieldPaths = criticalMissing.map((f: any) => f.fieldPath);

            // Record the status transition in the audit trail so the
            // claim's audit tab reflects WHY it is on hold and WHICH
            // fields are missing.
            await this.auditService.logEvent({
              eventType: 'CLAIM_STATUS',
              actorType: 'SYSTEM',
              action: 'CLAIM_ON_HOLD',
              targetType: 'CLAIM',
              targetId: input.claimId,
              details: {
                reason: 'Critical information missing from claim',
                completenessScore: completeness.score,
                recommendation: completeness.recommendation,
                criticalMissingFields: missingFieldPaths,
                missingFieldLabels,
                memberQueryCount: memberQuery.length,
                providerQueryCount: providerQuery.length,
              },
              previousValue: { status: priorClaim?.status ?? null },
              newValue: { status: 'ON_HOLD' },
            });

            await this.auditService.logEvent({
              eventType: 'CLAIM_VALIDATE',
              actorType: 'SYSTEM',
              action: 'COMPLETENESS_CHECKED',
              targetType: 'CLAIM',
              targetId: input.claimId,
              details: {
                score: completeness.score,
                recommendation: completeness.recommendation,
                criticalMissing: missingFieldPaths,
                canProcess: completeness.canProcess,
              },
            });

            warnings.push(`Claim placed on hold: ${missingFieldLabels.join(', ')}`);
          }
        } catch (error: any) {
          warnings.push(`Auto-correspondence failed: ${error.message}`);
        }
      }

      // ══════════════════════════════════════════════════
      // STAGE 8: DUPLICATE CHECK
      // ══════════════════════════════════════════════════
      currentStage = 'DUPLICATE_CHECK';
      logger.info(`[BupaPipeline] Stage 8: Duplicate check`);

      let isDuplicate = false;
      let duplicateCheck: any = null;
      try {
        duplicateCheck = await this.duplicateService.checkDuplicates({
          membershipNumber: input.membershipNumber,
          memberId: memberValidation?.member?.id,
          treatmentDate: input.treatmentDate,
          claimAmount: effectiveClaimAmount,
          currency: effectiveCurrency,
          facilityName: input.facilityName,
          primaryDiagnosis: undefined, // Will be populated after coding stage
          excludeClaimId: input.claimId,
        });
        isDuplicate = duplicateCheck.isDuplicate;
        if (duplicateCheck.duplicateType === 'EXACT') {
          warnings.push(`Exact duplicate detected: ${duplicateCheck.matchedClaims[0]?.claimReference}`);
        } else if (duplicateCheck.duplicateType === 'PROBABLE') {
          warnings.push(`Probable duplicate detected: ${duplicateCheck.matchedClaims[0]?.claimReference} (${duplicateCheck.confidence}% match)`);
        }
      } catch (error: any) {
        warnings.push(`Duplicate check failed: ${error.message}`);
      }

      // ══════════════════════════════════════════════════
      // STAGE 9: ICD-10 & CPT MEDICAL CODING
      // ══════════════════════════════════════════════════
      currentStage = 'MEDICAL_CODING';
      logger.info(`[BupaPipeline] Stage 9: ICD-10 & CPT coding`);

      let codingResult = null;
      let codingConfidence = 0;

      try {
        const codingPath = needsTranslation ? 'translation' : 'direct';
        codingResult = await extractICDCodes(englishText, codingPath, extraction.fullText, detectedLang);
      } catch (error: any) {
        errors.push(`ICD-10 coding failed: ${error.message}`);
      }

      const reconciliation = codingResult
        ? reconcileResults(codingResult, null)
        : { finalCodes: [], directOnlyCodes: [], translationOnlyCodes: [], agreedCodes: [], warnings: [] };

      if (reconciliation.finalCodes.length > 0) {
        codingConfidence = reconciliation.finalCodes.reduce(
          (sum: number, c: any) => sum + c.confidence, 0
        ) / reconciliation.finalCodes.length;
      }

      if (codingConfidence < CODING_ESCALATE_THRESHOLD && reconciliation.finalCodes.length > 0) {
        requiresHumanReview = true;
        humanReviewReason = `Coding confidence (${codingConfidence.toFixed(1)}%) below threshold. Clinical coder review needed.`;
      }

      // Build the pipeline result (existing format)
      pipelineResult = {
        claimId: input.claimId,
        fileName: extraction.fileName,
        processedAt: new Date().toISOString(),
        extraction,
        languageDetection,
        translation,
        directCoding: codingResult,
        translationCoding: null,
        reconciliation,
        processingTimeMs: Date.now() - startTime,
        errors,
      };

      // ══════════════════════════════════════════════════
      // STAGE 9b: OPCS-4 CODING (UK CLAIMS)
      // ══════════════════════════════════════════════════
      if (input.treatmentCountry?.toUpperCase() === 'GB' || input.treatmentCountry?.toUpperCase() === 'UK') {
        logger.info(`[BupaPipeline] Stage 9b: OPCS-4 coding for UK claim`);
        try {
          const opcs4Result = await extractOPCS4Codes({
            englishText: translation?.translatedText ?? extraction?.fullText ?? '',
            icdCodes: reconciliation.finalCodes.map((c: any) => ({ code: c.code, description: c.description })),
            treatmentType: input.treatmentType,
          });

          // Store OPCS-4 codes in claim_coding table
          if (opcs4Result.codes.length > 0 && input.claimId) {
            for (const code of opcs4Result.codes) {
              await this.prisma.claimCoding.create({
                data: {
                  claimId: input.claimId,
                  code: code.code,
                  codeType: 'OPCS4',
                  description: code.description,
                  confidence: code.confidence,
                  evidenceSource: code.evidenceText,
                  isValidated: false,
                  needsReview: code.needsReview,
                  isPrimary: false,
                },
              });
            }
            logger.info({ count: opcs4Result.codes.length }, 'OPCS-4 codes extracted and stored');
          }
        } catch (error: any) {
          warnings.push(`OPCS-4 coding failed: ${error.message}`);
        }
      }

      // ══════════════════════════════════════════════════
      // STAGE 10: CLINICAL VALIDATION
      // ══════════════════════════════════════════════════
      currentStage = 'CLINICAL_VALIDATION';
      logger.info(`[BupaPipeline] Stage 10: Clinical validation`);

      let clinicalValidation: any = null;
      let clinicalScore = 50;

      try {
        const primaryDiag = reconciliation.finalCodes[0]
          ? { code: reconciliation.finalCodes[0].code, description: reconciliation.finalCodes[0].description }
          : null;
        const secondaryDiags = reconciliation.finalCodes.slice(1).map((c: any) => ({
          code: c.code,
          description: c.description,
        }));

        clinicalValidation = this.clinicalService.validate({
          primaryDiagnosis: primaryDiag,
          secondaryDiagnoses: secondaryDiags,
          procedures: [],
          medications: [],
          treatmentType: input.treatmentType ?? null,
          admissionDate: null,
          dischargeDate: null,
          surgeryDate: null,
          claimAmount: effectiveClaimAmount ?? null,
          treatmentDescription: null,
          preExistingConditions: memberValidation?.member
            ? (memberValidation.member.preExistingConditions ?? [])
            : [],
        });
        clinicalScore = clinicalValidation.score;
      } catch (error: any) {
        errors.push(`Clinical validation failed: ${error.message}`);
        clinicalScore = 50; // Default when validation fails
      }

      if (clinicalScore < CLINICAL_AUTO_THRESHOLD) {
        currentStage = 'ESCALATED_CLINICAL';
        requiresHumanReview = true;
        humanReviewReason = `Clinical validation score (${clinicalScore.toFixed(1)}%) requires clinical reviewer.`;
      }

      // ══════════════════════════════════════════════════
      // STAGE 11: COVERAGE ANALYSIS
      // ══════════════════════════════════════════════════
      currentStage = 'COVERAGE_ANALYSIS';
      logger.info(`[BupaPipeline] Stage 11: Coverage analysis`);

      try {
        const planTier = memberValidation?.member?.planTier ?? 'PREMIER';
        const deductibleRemaining = eligibility?.deductibleRemaining ?? 0;
        const coInsuranceRate = memberValidation?.member?.coInsuranceRate ?? null;
        const isOutOfNetwork = providerValidation?.networkAnalysis?.isInNetwork === false;
        const networkPenaltyRate = providerValidation?.networkAnalysis?.coInsurancePenalty ?? 0;

        // Build line items from claim amount
        const lineItems: ClaimLineItem[] = [{
          index: 0,
          description: 'Total claim amount',
          amount: effectiveClaimAmount ?? 0,
          category: 'OTHER',
        }];

        coverageAnalysis = this.coverageService.analyzeCoverage({
          lineItems,
          planTier,
          deductibleRemaining,
          coInsuranceRate,
          isOutOfNetwork,
          networkPenaltyRate,
          currency: effectiveCurrency ?? 'USD',
          annualUsed: 0,
        });
      } catch (error: any) {
        errors.push(`Coverage analysis failed: ${error.message}`);
      }

      // ══════════════════════════════════════════════════
      // STAGE 11b: PAYMENT CALCULATION
      // ══════════════════════════════════════════════════
      logger.info(`[BupaPipeline] Stage 11b: Payment calculation`);

      let paymentCalculation: any = null;
      try {
        const lineItemInputs = coverageAnalysis?.lineItemDecisions?.map((d: any) => ({
          description: d.description,
          amount: d.amountClaimed,
          isCovered: d.isCovered,
          benefitCategory: d.benefitCategory,
          denialReason: d.denialReason,
        })) ?? [{ description: 'Total claim', amount: effectiveClaimAmount ?? 0, isCovered: true, benefitCategory: 'OTHER' }];

        paymentCalculation = this.paymentService.calculate({
          claimAmount: effectiveClaimAmount ?? 0,
          claimCurrency: effectiveCurrency ?? 'USD',
          paymentCurrency: effectiveCurrency ?? 'USD',
          treatmentDate: input.treatmentDate ?? new Date().toISOString().split('T')[0],
          deductibleAmount: memberValidation?.member?.deductible?.amount ?? 0,
          deductibleUsed: memberValidation?.member?.deductible?.used ?? 0,
          deductibleCurrency: memberValidation?.member?.deductible?.currency ?? 'USD',
          coInsuranceRate: memberValidation?.member?.coInsuranceRate ?? null,
          isOutOfNetwork: providerValidation?.networkAnalysis?.isInNetwork === false,
          outOfNetworkPenaltyRate: providerValidation?.networkAnalysis?.coInsurancePenalty ?? 0,
          benefitLimit: null,
          benefitUsedThisYear: 0,
          benefitLimitCurrency: effectiveCurrency ?? 'USD',
          annualMaximum: coverageAnalysis?.annualMaximum?.limit ?? null,
          annualMaximumUsed: coverageAnalysis?.annualMaximum?.used ?? 0,
          annualMaximumCurrency: effectiveCurrency ?? 'USD',
          lineItems: lineItemInputs,
          payeeType: 'HOSPITAL',
          paymentMethod: 'BANK_TRANSFER',
        });
      } catch (error: any) {
        errors.push(`Payment calculation failed: ${error.message}`);
      }

      // ══════════════════════════════════════════════════
      // STAGE 12: ADJUDICATION
      // ══════════════════════════════════════════════════
      currentStage = 'ADJUDICATION';
      logger.info(`[BupaPipeline] Stage 12: Adjudication`);

      try {
        adjudication = this.adjudicationService.adjudicate({
          claimReference: input.claimId ?? 'BG-UNKNOWN',
          memberValidation: { isValid: memberValidation?.isValid ?? false, member: memberValidation?.member },
          eligibility: {
            isEligible: eligibility?.isEligible ?? false,
            isChecked: !!eligibility,
            preAuthRequired: eligibility?.preAuthRequired ?? false,
            reason: eligibility?.reason ?? 'Unknown',
            failedChecks: (eligibility?.checks ?? [])
              .filter((c: { status: string }) => c.status === 'fail')
              .map((c: { name: string }) => c.name),
          },
          providerValidation: {
            isValid: providerValidation?.isValid ?? true,
            provider: providerValidation?.provider,
            networkAnalysis: providerValidation?.networkAnalysis,
          },
          completeness: {
            score: completeness?.score ?? 0,
            isComplete: completeness?.isComplete ?? false,
            canProcess: completeness?.canProcess ?? false,
            criticalMissing: completeness?.criticalMissing ?? [],
          },
          codingConfidence,
          clinicalValidationScore: clinicalScore,
          coverageAnalysis: {
            overallDecision: coverageAnalysis?.overallDecision ?? 'NOT_COVERED',
            totalClaimed: effectiveClaimAmount ?? 0,
            totalPayable: coverageAnalysis?.totalPayable ?? 0,
            totalDenied: coverageAnalysis?.totalDenied ?? 0,
            exclusionsTriggered: coverageAnalysis?.exclusionsTriggered ?? [],
          },
          isDuplicate,
          isComplaint: false,
          hasLegalCorrespondence: false,
          claimAmount: effectiveClaimAmount ?? 0,
          highValueThreshold,
        });

        if (adjudication.requiresHumanReview) {
          requiresHumanReview = true;
          humanReviewReason = adjudication.humanReviewReason;
        }

        if (adjudication.decision === 'DENIED') {
          currentStage = 'DENIED';
        }
      } catch (error: any) {
        errors.push(`Adjudication failed: ${error.message}`);
      }

      // ══════════════════════════════════════════════════
      // STAGE 13: EDI 837 GENERATION
      // ══════════════════════════════════════════════════
      if (adjudication?.decision !== 'DENIED' && !requiresHumanReview) {
        currentStage = 'EDI_GENERATION';
        logger.info(`[BupaPipeline] Stage 13: EDI 837 generation`);

        try {
          const diagnoses = reconciliation.finalCodes.map((c: any, i: number) => ({
            code: c.code,
            isPrimary: i === 0,
          }));

          // Build procedure list from coverage analysis line items
          const procedures = (coverageAnalysis?.lineItemDecisions ?? []).map((d: any) => ({
            code: d.procedureCode ?? d.benefitCategory ?? 'MISC',
            description: d.description ?? '',
            amount: d.amountClaimed ?? 0,
            serviceDate: input.treatmentDate ?? new Date().toISOString().split('T')[0],
          }));

          // Build financial data from paymentCalculation result
          const financial = paymentCalculation ? {
            totalPayable: paymentCalculation.totalPayable ?? 0,
            deductibleApplied: paymentCalculation.deductibleApplied ?? 0,
            coInsuranceApplied: paymentCalculation.coInsuranceApplied ?? 0,
            networkPenaltyApplied: paymentCalculation.networkPenaltyApplied ?? 0,
            benefitLimitExcess: paymentCalculation.benefitLimitExcess ?? 0,
            annualMaximumExcess: paymentCalculation.annualMaximumExcess ?? 0,
            paymentCurrency: paymentCalculation.paymentCurrency ?? effectiveCurrency ?? 'USD',
            fxRate: paymentCalculation.fxRate ?? null,
            lineItems: (paymentCalculation.lineItemResults ?? []).map((li: any, idx: number) => ({
              procedureCode: procedures[idx]?.code ?? 'MISC',
              chargedAmount: li.amountClaimed ?? 0,
              allowedAmount: li.amountPayable + (li.deductibleApplied ?? 0) + (li.coInsuranceApplied ?? 0),
              paidAmount: li.amountPayable ?? 0,
              deductible: li.deductibleApplied ?? 0,
              coInsurance: li.coInsuranceApplied ?? 0,
              adjustmentReason: li.denialReason ?? null,
            })),
          } : undefined;

          edi = this.ediService.generate837P({
            claimReference: input.claimId ?? 'BG-UNKNOWN',
            submitterName: 'BUPA GLOBAL',
            submitterIdentifier: 'BUPAGLOBAL',
            receiverName: 'CLEARINGHOUSE',
            receiverIdentifier: 'CLEARINGHS',
            member: {
              membershipNumber: memberValidation?.member?.membershipNumber ?? '',
              firstName: memberValidation?.member?.fullName?.split(' ')[0] ?? '',
              lastName: memberValidation?.member?.fullName?.split(' ').slice(1).join(' ') ?? '',
              dateOfBirth: memberValidation?.member?.dateOfBirth ?? '',
              address: {},
            },
            provider: {
              providerName: providerValidation?.provider?.providerName ?? '',
              facilityName: providerValidation?.provider?.facilityName ?? '',
              address: {},
            },
            claim: {
              totalAmount: effectiveClaimAmount ?? 0,
              currency: effectiveCurrency ?? 'USD',
              treatmentDate: input.treatmentDate ?? new Date().toISOString().split('T')[0],
            },
            diagnoses,
            procedures,
            financial,
          });
        } catch (error: any) {
          errors.push(`EDI generation failed: ${error.message}`);
        }
      }

      // ══════════════════════════════════════════════════
      // STAGE 14: JSON OUTPUT GENERATION
      // ══════════════════════════════════════════════════
      currentStage = 'JSON_GENERATION';
      logger.info(`[BupaPipeline] Stage 14: JSON output generation`);

      try {
        claimJson = this.jsonFormatter.formatClaimJson({
          claimReference: input.claimId ?? 'BG-UNKNOWN',
          member: memberValidation?.member ?? null,
          provider: providerValidation?.provider ?? null,
          treatment: {
            country: input.treatmentCountry ?? 'Unknown',
            treatmentType: input.treatmentType ?? 'OUTPATIENT',
            primaryDiagnosis: reconciliation.finalCodes[0] ?? null,
            procedures: [],
            medications: [],
          },
          financials: {
            currency: effectiveCurrency ?? 'USD',
            totalClaimed: effectiveClaimAmount ?? 0,
            deductibleApplied: coverageAnalysis?.totalDeductible ?? 0,
            coInsuranceApplied: coverageAnalysis?.totalCoInsurance ?? 0,
            networkPenalty: coverageAnalysis?.totalNetworkPenalty ?? 0,
            totalPayable: coverageAnalysis?.totalPayable ?? adjudication?.payableAmount ?? 0,
            lineItems: coverageAnalysis?.lineItemDecisions ?? [],
          },
          payment: null,
          decision: {
            status: adjudication?.decision ?? 'HUMAN_REVIEW',
            reason: adjudication?.reason ?? 'Pending adjudication',
            adjudicatedBy: adjudication?.adjudicatedBy ?? 'PENDING_HUMAN',
            adjudicatedAt: new Date().toISOString(),
            humanReviewRequired: requiresHumanReview,
          },
          coding: {
            icd10: reconciliation.finalCodes
              .filter((c: any) => true) // All codes are ICD-10 from current pipeline
              .map((c: any, i: number) => ({
                code: c.code,
                type: i === 0 ? 'PRIMARY' : 'SECONDARY',
                confidence: Math.round(c.confidence),
                validated: c.isValidated ?? false,
              })),
            cpt: [],
          },
          coverageAnalysis: coverageAnalysis ?? null,
          documents: [],
          auditTrail: [
            { timestamp: new Date().toISOString(), event: 'PIPELINE_COMPLETE', actor: 'SYSTEM' },
          ],
        });
      } catch (error: any) {
        errors.push(`JSON output generation failed: ${error.message}`);
      }

      // ══════════════════════════════════════════════════
      // COMPLETE
      // ══════════════════════════════════════════════════
      if (!requiresHumanReview && errors.length === 0) {
        currentStage = 'COMPLETE';
      }

    } catch (error: any) {
      errors.push(`Pipeline error at stage ${currentStage}: ${error.message}`);
      logger.error(`[BupaPipeline] Fatal error at stage ${currentStage}`, error);
    }

    const processingTimeMs = Date.now() - startTime;
    logger.info(`[BupaPipeline] Pipeline finished at stage ${currentStage} in ${(processingTimeMs / 1000).toFixed(1)}s`);

    return {
      claimId: input.claimId,
      stage: currentStage,
      pipeline: pipelineResult!,
      memberValidation,
      eligibility,
      providerValidation,
      completeness,
      coverageAnalysis,
      adjudication,
      clinicalValidation,
      duplicateCheck,
      paymentCalculation,
      edi,
      claimJson,
      extractedFinancials: {
        amount: effectiveClaimAmount ?? null,
        currency: effectiveCurrency ?? null,
        itemisedCharges: extractedFormData?.medicalDetails?.itemisedCharges ?? null,
      },
      extractedPatient: (() => {
        const pd = extractedFormData?.patientDetails;
        const first = pd?.firstName ?? null;
        const last = pd?.lastName ?? null;
        const composed = `${first ?? ''} ${last ?? ''}`.trim();
        return {
          name: composed.length > 0 ? composed : null,
          firstName: first,
          lastName: last,
          dateOfBirth: pd?.dateOfBirth ?? null,
          membershipNumber: pd?.membershipNumber ?? null,
          email: pd?.email ?? null,
          telephone: pd?.telephone ?? null,
        };
      })(),


      errors,
      warnings,
      processingTimeMs,
      requiresHumanReview,
      humanReviewReason,
    };
  }
}
