// Bupa Global Claim Form (STH) Extractor Service
// Uses Bedrock Claude to extract structured fields from PDF text

import { invokeBedrockModel } from './bedrockClient';
import { logger } from '../config/logger';
import type { BupaClaimFormData } from './completenessCheck.service';
import { StructuredDataExtractor } from './pipeline/structuredDataExtractor';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_TEXT_LENGTH = 10_000;

const EXTRACTION_PROMPT = `You are extracting structured data from a Bupa Global health insurance claim form (STH) or associated invoice/receipt.
The form or document may have these sections:

Section 1 - Patient's Details:
- Patient membership number (format: BI-XXXX-XXXX-XXXX)
- Group name (if applicable)
- Title (Mr/Mrs/Ms/Miss/Dr)
- First name, Family name
- Date of birth (DD/MM/YYYY)
- Address (building, street, town, area code, region, country)
- Email, Telephone

Section 2 - Claim/Medical Details:
- Treatment country
- Invoice currency (HKD, USD, GBP, EUR, etc.)
- Total claimed amount
- Reason for treatment (symptoms and diagnosis)
- Treatment type (Wellness, Maternity, Oncology, Dental, Opticians, Pre/post hospitalisation)
- When symptoms began
- Date of treatment/consultation
- Details of treatment including operations and medications
- Medical practitioner name, specialty, facility name, address
- Hospital admission/discharge/surgery dates, hospital name

Section 3 - Cash Benefit:
- Whether cash benefit applies
- Hospital stay dates
- Hospital stamp verified

Section 4 - Payment Details:
- Who to pay (Medical Practitioner/Hospital/Patient/Group)
- Bank details (name, SWIFT, account number, sort code, IBAN, holder name, currency)
- Cheque preference

Section 5 - Third Party:
- Whether third party recovery applies
- Third party contact details

Section 6 - Medical Report Consent:
- Consent given
- Report viewing preference

Section 8 - Declaration:
- Signature present
- Signature date
- Print name

Extract ALL fields from the text below. Return null for fields not found.
Return the result as JSON matching this exact structure:

{
  "patientDetails": {
    "membershipNumber": "string | null",
    "groupName": "string | null",
    "title": "string | null",
    "firstName": "string | null",
    "lastName": "string | null",
    "dateOfBirth": "string | null",
    "address": {
      "building": "string | null",
      "street": "string | null",
      "town": "string | null",
      "areaCode": "string | null",
      "region": "string | null",
      "country": "string | null"
    },
    "email": "string | null",
    "telephone": "string | null"
  },
  "medicalDetails": {
    "treatmentCountry": "string | null",
    "invoiceCurrency": "string | null",
    "totalClaimedAmount": "number | null",
    "itemisedCharges": [
      { "description": "string", "amount": "number" }
    ],
    "reasonForTreatment": "string | null",
    "treatmentType": "string | null",
    "symptomStartDate": "string | null",
    "treatmentDate": "string | null",
    "treatmentDescription": "string | null",
    "practitionerName": "string | null",
    "practitionerSpecialty": "string | null",
    "facilityName": "string | null",
    "facilityAddress": "string | null",
    "admissionDate": "string | null",
    "dischargeDate": "string | null",
    "surgeryDate": "string | null",
    "hospitalName": "string | null"
  },
  "cashBenefit": {
    "applicable": "boolean | null",
    "hospitalStayFrom": "string | null",
    "hospitalStayTo": "string | null",
    "hospitalStampVerified": "boolean | null"
  },
  "paymentDetails": {
    "payeeType": "string | null",
    "bankName": "string | null",
    "swiftCode": "string | null",
    "accountNumber": "string | null",
    "sortCode": "string | null",
    "iban": "string | null",
    "accountHolderName": "string | null",
    "accountCurrency": "string | null",
    "chequeCurrencyPreference": "string | null"
  },
  "thirdParty": {
    "applicable": "boolean | null",
    "name": "string | null",
    "contact": "string | null"
  },
  "consent": {
    "consentGiven": "boolean | null",
    "reportViewPreference": "string | null"
  },
  "declaration": {
    "signaturePresent": "boolean | null",
    "signatureDate": "string | null",
    "printName": "string | null"
  }
}

Return ONLY valid JSON. No markdown fences. No commentary before or after the JSON.
IMPORTANT: The 'totalClaimedAmount' should be a pure number (no currency symbols, no commas).
If a currency symbol is present, extract it into 'invoiceCurrency' (e.g., 'HKD', 'USD', 'GBP').

CLAIM FORM TEXT:
`;

// ─── Empty form (used as fallback on parse failure) ──────────────────────────

function createEmptyFormData(): BupaClaimFormData {
  return {
    patientDetails: {
      membershipNumber: null,
      groupName: null,
      title: null,
      firstName: null,
      lastName: null,
      dateOfBirth: null,
      address: {
        building: null,
        street: null,
        town: null,
        areaCode: null,
        region: null,
        country: null,
      },
      email: null,
      telephone: null,
    },
    medicalDetails: {
      treatmentCountry: null,
      invoiceCurrency: null,
      totalClaimedAmount: null,
      itemisedCharges: null,
      reasonForTreatment: null,
      treatmentType: null,
      symptomStartDate: null,
      treatmentDate: null,
      treatmentDescription: null,
      practitionerName: null,
      practitionerSpecialty: null,
      facilityName: null,
      facilityAddress: null,
      admissionDate: null,
      dischargeDate: null,
      surgeryDate: null,
      hospitalName: null,
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
}

// ─── JSON parsing helpers ────────────────────────────────────────────────────

function parseExtractedNumber(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Look for a plausible person name inside the "[PDF Annotations]" block
 * that parsePdf appends to the extracted text. Used as a last-resort
 * fallback when both the LLM extraction and label-based regex fail.
 *
 * Accepts 2-4 word capitalised tokens (e.g. "Jason Momoa", "Dr John Smith").
 */
function extractAnnotationName(text: string): string | null {
  const marker = '[PDF Annotations]';
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const block = text.slice(idx + marker.length);
  // Stop at the next page break or section marker.
  const stopIdx = block.search(/\n\s*---\s*Page Break\s*---|\n\s*\[/i);
  const scope = (stopIdx === -1 ? block : block.slice(0, stopIdx)).trim();
  if (!scope) return null;

  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/;
  for (const line of scope.split(/\n+/)) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    const match = cleaned.match(namePattern);
    if (match) return match[1];
  }
  return null;
}

function extractJsonFromResponse(raw: string): string {
  let jsonStr = raw.trim();

  // Remove markdown code blocks if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Find the outermost JSON object
  const objectStart = jsonStr.indexOf('{');
  const objectEnd = jsonStr.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1) {
    jsonStr = jsonStr.substring(objectStart, objectEnd + 1);
  }

  return jsonStr;
}

function coerceToFormData(parsed: Record<string, unknown>): BupaClaimFormData {
  const empty = createEmptyFormData();

  return {
    patientDetails: {
      ...empty.patientDetails,
      ...(typeof parsed.patientDetails === 'object' && parsed.patientDetails !== null
        ? {
            ...(parsed.patientDetails as Record<string, unknown>),
            address:
              typeof (parsed.patientDetails as Record<string, unknown>).address === 'object' &&
              (parsed.patientDetails as Record<string, unknown>).address !== null
                ? {
                    ...empty.patientDetails.address,
                    ...((parsed.patientDetails as Record<string, unknown>).address as Record<string, unknown>),
                  }
                : empty.patientDetails.address,
          }
        : {}),
    } as BupaClaimFormData['patientDetails'],
    medicalDetails: {
      ...empty.medicalDetails,
      ...(typeof parsed.medicalDetails === 'object' && parsed.medicalDetails !== null
        ? {
            ...(parsed.medicalDetails as Record<string, unknown>),
            totalClaimedAmount: parseExtractedNumber((parsed.medicalDetails as Record<string, any>).totalClaimedAmount),
            itemisedCharges: Array.isArray((parsed.medicalDetails as Record<string, any>).itemisedCharges)
              ? (parsed.medicalDetails as Record<string, any>).itemisedCharges.map((item: any) => ({
                  description: String(item.description || 'Charge'),
                  amount: parseExtractedNumber(item.amount) || 0,
                }))
              : null,
          }
        : {}),
    } as BupaClaimFormData['medicalDetails'],
    cashBenefit: {
      ...empty.cashBenefit,
      ...(typeof parsed.cashBenefit === 'object' && parsed.cashBenefit !== null
        ? (parsed.cashBenefit as Record<string, unknown>)
        : {}),
    } as BupaClaimFormData['cashBenefit'],
    paymentDetails: {
      ...empty.paymentDetails,
      ...(typeof parsed.paymentDetails === 'object' && parsed.paymentDetails !== null
        ? (parsed.paymentDetails as Record<string, unknown>)
        : {}),
    } as BupaClaimFormData['paymentDetails'],
    thirdParty: {
      ...empty.thirdParty,
      ...(typeof parsed.thirdParty === 'object' && parsed.thirdParty !== null
        ? (parsed.thirdParty as Record<string, unknown>)
        : {}),
    } as BupaClaimFormData['thirdParty'],
    consent: {
      ...empty.consent,
      ...(typeof parsed.consent === 'object' && parsed.consent !== null
        ? (parsed.consent as Record<string, unknown>)
        : {}),
    } as BupaClaimFormData['consent'],
    declaration: {
      ...empty.declaration,
      ...(typeof parsed.declaration === 'object' && parsed.declaration !== null
        ? (parsed.declaration as Record<string, unknown>)
        : {}),
    } as BupaClaimFormData['declaration'],
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class BupaClaimFormExtractorService {
  private readonly fallbackExtractor = new StructuredDataExtractor();

  /**
   * Extract structured Bupa claim form fields from raw text using Bedrock Claude.
   *
   * Builds a detailed prompt describing every section and field of the Bupa Global
   * STH form, sends it to Bedrock, and parses the structured JSON response into
   * a BupaClaimFormData object.  Returns an empty form (all nulls) on parse failure.
   */
  async extractFromText(text: string): Promise<BupaClaimFormData> {
    if (!text || text.trim().length === 0) {
      logger.warn('[BupaExtractor] Empty text provided, returning empty form data');
      return createEmptyFormData();
    }

    const inputText = text.length > MAX_TEXT_LENGTH
      ? text.substring(0, MAX_TEXT_LENGTH)
      : text;

    const prompt = EXTRACTION_PROMPT + inputText;

    logger.info(
      { textLength: inputText.length },
      '[BupaExtractor] Extracting claim form fields from text',
    );

    let rawResponse = '';
    try {
      rawResponse = await invokeBedrockModel(prompt, {
        maxTokens: 4096,
        temperature: 0,
      });

      const jsonStr = extractJsonFromResponse(rawResponse);
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      let formData = coerceToFormData(parsed);

      // --- Fallback for financials ---
      if (formData.medicalDetails.totalClaimedAmount === null || formData.medicalDetails.invoiceCurrency === null) {
        logger.info('[BupaExtractor] Missing financials in AI response, attempting regex fallback');
        const fallback = this.fallbackExtractor.extractStructuredData(text);
        
        let shouldUpdate = false;
        let newAmount = formData.medicalDetails.totalClaimedAmount;
        let newCurrency = formData.medicalDetails.invoiceCurrency;

        if (formData.medicalDetails.totalClaimedAmount === null && fallback.financials.totalClaimed !== null) {
          newAmount = fallback.financials.totalClaimed;
          shouldUpdate = true;
          logger.info({ amount: newAmount }, '[BupaExtractor] Recovered amount via regex');
        }
        
        if (formData.medicalDetails.invoiceCurrency === null && fallback.financials.currency !== null) {
          newCurrency = fallback.financials.currency;
          shouldUpdate = true;
          logger.info({ currency: newCurrency }, '[BupaExtractor] Recovered currency via regex');
        }

        if (shouldUpdate || (formData.medicalDetails.itemisedCharges === null && fallback.financials.itemisedCharges.length > 0)) {
          formData = {
            ...formData,
            medicalDetails: {
              ...formData.medicalDetails,
              totalClaimedAmount: newAmount,
              invoiceCurrency: newCurrency,
              itemisedCharges: formData.medicalDetails.itemisedCharges ?? (fallback.financials.itemisedCharges.length > 0 ? fallback.financials.itemisedCharges : null),
            },
          };
        }
      }

      // --- Fallback for patient name ---
      if (formData.patientDetails.firstName === null && formData.patientDetails.lastName === null) {
        let recoveredName: string | null = null;

        // 1) Try the "Print name" from the declaration section. If the patient themselves
        // signed the form, this is a very reliable source of truth.
        if (formData.declaration && formData.declaration.printName) {
          recoveredName = formData.declaration.printName.trim();
          logger.info({ name: recoveredName }, '[BupaExtractor] Recovered patient name from declaration print name');
        }

        // 2) Try regex fallback over the full text ("Name: X", "Patient: X").
        if (!recoveredName) {
          const fallback = this.fallbackExtractor.extractStructuredData(text);
          if (fallback.claimant.name) {
            recoveredName = fallback.claimant.name.trim();
            logger.info({ name: recoveredName }, '[BupaExtractor] Recovered patient name via regex');
          }
        }

        // 3) Fall back to any standalone text inside the [PDF Annotations]
        // block injected by parsePdf. FreeText overlays (e.g. a name stamped
        // on a scanned receipt) often don't carry a "Name:" label and are
        // invisible to rasterised OCR, so we read them from the PDF object
        // model and trust the first plausible name-shaped line.
        if (!recoveredName) {
          recoveredName = extractAnnotationName(text);
          if (recoveredName) {
            logger.info({ name: recoveredName }, '[BupaExtractor] Recovered patient name from annotation block');
          }
        }

        if (recoveredName) {
          const parts = recoveredName.split(/\s+/);
          formData = {
            ...formData,
            patientDetails: {
              ...formData.patientDetails,
              firstName: parts[0] || null,
              lastName: parts.slice(1).join(' ') || null,
            },
          };
        }
      }

      logger.info('[BupaExtractor] Successfully extracted claim form data');
      return formData;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      
      logger.error(
        { 
          error: message, 
          rawResponse: rawResponse ? rawResponse.substring(0, 1000) : 'No response captured' 
        },
        '[BupaExtractor] Failed to extract or parse claim form data, returning empty form',
      );
      return createEmptyFormData();
    }
  }

  /**
   * Wrapper that accepts a PDF extraction result and delegates to extractFromText.
   *
   * If the full text exceeds MAX_TEXT_LENGTH characters, only the first
   * MAX_TEXT_LENGTH characters are sent to the model to stay within prompt limits.
   */
  async extractFromPdfResult(
    extraction: { fullText: string; pages: ReadonlyArray<{ text: string }> },
  ): Promise<BupaClaimFormData> {
    const text = extraction.fullText ?? '';

    if (text.length === 0 && extraction.pages.length > 0) {
      const combinedText = extraction.pages.map((p) => p.text).join('\n');
      return this.extractFromText(combinedText);
    }

    return this.extractFromText(text);
  }
}
