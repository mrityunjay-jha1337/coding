import { z } from 'zod';
import type {
  IngestedEmail,
  EmailClassification,
  CorrespondenceType,
  Priority,
  GmailFilterRule,
} from '../../../shared/emailTypes';
import { invokeBedrockModel } from '../bedrockClient';

// ─── CONSTANTS ──────────────────────────────────────────

const BODY_LIMIT = 2000;
const CLAIM_REF_PATTERN = /CLM-\d{4}-\d{5}/;

const SAFE_DEFAULTS: Readonly<EmailClassification> = Object.freeze({
  correspondenceType: 'SUPPORTING_DOC',
  priority: 'normal',
  existingClaimRef: null,
  isReplyToQuery: false,
  suggestedClient: null,
  confidence: 0,
});

// ─── ZOD VALIDATION SCHEMA ──────────────────────────────

const correspondenceTypeSchema = z.enum([
  'FNOL',
  'MEDICAL_REPORT',
  'INVOICE',
  'SUPPORTING_DOC',
  'QUERY_RESPONSE',
  'STATUS_ENQUIRY',
  'COMPLAINT',
  'SOLICITOR_CORRESPONDENCE',
  'THIRD_PARTY',
  'NOT_A_CLAIM',
]);

const prioritySchema = z.enum(['urgent', 'high', 'normal', 'low']);

const classificationSchema = z.object({
  correspondenceType: correspondenceTypeSchema,
  priority: prioritySchema,
  existingClaimRef: z.string().nullable(),
  isReplyToQuery: z.boolean(),
  suggestedClient: z.string().nullable(),
  confidence: z.number().min(0).max(100),
});

// ─── RULE-BASED CLASSIFICATION RULES ────────────────────

interface ClassificationRule {
  readonly keywords: readonly string[];
  readonly type: CorrespondenceType;
  readonly priority: Priority;
}

const CLASSIFICATION_RULES: readonly ClassificationRule[] = Object.freeze([
  Object.freeze({
    keywords: ['solicitor', 'legal'],
    type: 'SOLICITOR_CORRESPONDENCE' as CorrespondenceType,
    priority: 'urgent' as Priority,
  }),
  Object.freeze({
    keywords: ['complaint'],
    type: 'COMPLAINT' as CorrespondenceType,
    priority: 'urgent' as Priority,
  }),
  Object.freeze({
    keywords: ['claim', 'fnol', 'notification of loss', 'bupa', 'global', 'submission'],
    type: 'FNOL' as CorrespondenceType,
    priority: 'normal' as Priority,
  }),
  Object.freeze({
    keywords: ['invoice', 'receipt', 'bill'],
    type: 'INVOICE' as CorrespondenceType,
    priority: 'normal' as Priority,
  }),
  Object.freeze({
    keywords: ['medical report', 'discharge', 'diagnosis'],
    type: 'MEDICAL_REPORT' as CorrespondenceType,
    priority: 'normal' as Priority,
  }),
  Object.freeze({
    keywords: ['status', 'update'],
    type: 'STATUS_ENQUIRY' as CorrespondenceType,
    priority: 'low' as Priority,
  }),
]);

// ─── PROMPT BUILDER ─────────────────────────────────────

function buildClassificationPrompt(email: IngestedEmail): string {
  const senderDomain = email.from.email.split('@')[1] ?? 'unknown';
  const attachmentTypes = email.attachments
    .map((a) => a.mimeType)
    .join(', ') || 'none';
  const bodySnippet = email.bodyText.substring(0, BODY_LIMIT);

  return `You are an insurance claims email classification agent. Analyze the following email and classify it.

Subject: ${email.subject}
From: ${email.from.email} (domain: ${senderDomain})
Attachment types: ${attachmentTypes}

Body (first ${BODY_LIMIT} chars):
${bodySnippet}

Classify this email into EXACTLY ONE of these types:
- FNOL (First Notification of Loss — new claim, even if it just says "New Submission" or mentions "Bupa Global")
- MEDICAL_REPORT (medical documents, discharge summaries, diagnoses)
- INVOICE (bills, receipts, invoices for treatment/repair)
- SUPPORTING_DOC (supporting evidence, photos, statements)
- QUERY_RESPONSE (reply to an outbound query)
- STATUS_ENQUIRY (asking about claim status/progress)
- COMPLAINT (formal complaint about service/delay)
- SOLICITOR_CORRESPONDENCE (legal correspondence)
- THIRD_PARTY (third-party insurer or adjuster communication)
- NOT_A_CLAIM (Ads, spam, internal office chat, or completely unrelated to health insurance)

Assign a priority: urgent, high, normal, low

Also determine:
- existingClaimRef: Extract any claim reference (pattern CLM-XXXX-XXXXX) or null
- isReplyToQuery: Is this email a reply to a previously sent query? (true/false)
- suggestedClient: If the sender can be mapped to a known client, provide the name, otherwise null
- confidence: 0-100 how confident you are in this classification

Return ONLY valid JSON. No markdown. No commentary.
{
  "correspondenceType": "...",
  "priority": "...",
  "existingClaimRef": "..." or null,
  "isReplyToQuery": true/false,
  "suggestedClient": "..." or null,
  "confidence": 85
}`;
}

// ─── HELPERS ────────────────────────────────────────────

function extractClaimReference(text: string): string | null {
  const match = text.match(CLAIM_REF_PATTERN);
  return match ? match[0] : null;
}

function parseJsonFromResponse(raw: string): JSON {
  let jsonStr = raw.trim();

  // Strip markdown code fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Extract the outermost JSON object
  const objectStart = jsonStr.indexOf('{');
  const objectEnd = jsonStr.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1) {
    jsonStr = jsonStr.substring(objectStart, objectEnd + 1);
  }

  return JSON.parse(jsonStr);
}

// ─── CLASSIFICATION AGENT ───────────────────────────────

export type ClassifyFn = (email: IngestedEmail) => Promise<EmailClassification>;

export class ClassificationAgent {
  /**
   * Classify an email using AI (Bedrock Claude).
   * Accepts an optional classifyFn for testing/mocking.
   */
  async classifyEmail(
    email: IngestedEmail,
    classifyFn?: ClassifyFn,
    dynamicRules?: GmailFilterRule[]
  ): Promise<EmailClassification> {
    // 1. Check dynamic rules first (explicit overrides)
    if (dynamicRules && dynamicRules.length > 0) {
      const ruleResult = this.applyDynamicRules(email, dynamicRules);
      if (ruleResult) {
        // If it's an exclusion, Return immediately
        if (ruleResult.correspondenceType === 'NOT_A_CLAIM') {
          return { ...SAFE_DEFAULTS, correspondenceType: 'NOT_A_CLAIM', confidence: 100 };
        }
        // Otherwise, we might still want AI to classify the type, 
        // but we can merge the rule matches later.
      }
    }

    if (classifyFn) {
      return classifyFn(email);
    }

    const aiResult = await this.classifyWithAI(email);

    // 2. Safety Net: If subject contains "Claim" or "Bupa", force FNOL to avoid AI false negatives
    const subjectLower = email.subject.toLowerCase();
    const isObviousClaim = ['claim', 'bupa', 'global', 'submission'].some(k => subjectLower.includes(k));

    if (isObviousClaim && aiResult.correspondenceType === 'NOT_A_CLAIM') {
      return {
        ...aiResult,
        correspondenceType: 'FNOL',
        confidence: 90,
        priority: aiResult.priority === 'normal' ? 'high' : aiResult.priority
      };
    }

    // 3. Merge dynamic overrides if any (e.g. priority override)
    if (dynamicRules && dynamicRules.length > 0) {
      const ruleResult = this.applyDynamicRules(email, dynamicRules);
      if (ruleResult) {
        return { ...aiResult, ...ruleResult };
      }
    }

    return aiResult;
  }

  /**
   * Evaluates dynamic connector rules against an email.
   */
  private applyDynamicRules(email: IngestedEmail, rules: GmailFilterRule[]): Partial<EmailClassification> | null {
    const subject = email.subject.toLowerCase();
    const from = email.from.email.toLowerCase();
    const body = email.bodyText.toLowerCase();

    let override: Partial<EmailClassification> = {};
    let matched = false;

    for (const rule of rules) {
      let isMatch = false;
      const val = rule.value.toLowerCase();

      switch (rule.type) {
        case 'sender_domain':
          isMatch = from.includes(val);
          break;
        case 'subject_keyword':
          isMatch = subject.includes(val);
          break;
        case 'exclusion':
          if (subject.includes(val) || body.includes(val) || from.includes(val)) {
            return { correspondenceType: 'NOT_A_CLAIM' };
          }
          break;
        case 'priority':
          // Only apply if the rule matches some criteria (usually keyword in subject/body)
          // For simplicity, if value contains ':' it's "keyword:priority"
          if (val.includes(':')) {
            const [keyword, p] = val.split(':');
            if (subject.includes(keyword) || body.includes(keyword)) {
              override.priority = p as Priority;
              matched = true;
            }
          }
          break;
      }

      if (isMatch) {
        matched = true;
        // Map specific actions if defined
        if (rule.action === 'exclude') override.correspondenceType = 'NOT_A_CLAIM';
      }
    }

    return matched || override.correspondenceType ? override : null;
  }

  /**
   * AI-based classification via AWS Bedrock Claude.
   */
  async classifyWithAI(email: IngestedEmail): Promise<EmailClassification> {
    const prompt = buildClassificationPrompt(email);

    try {
      const rawResponse = await invokeBedrockModel(prompt, {
        maxTokens: 1024,
        temperature: 0.1,
      });

      const parsed = parseJsonFromResponse(rawResponse);
      const validated = classificationSchema.safeParse(parsed);

      if (validated.success) {
        return Object.freeze(validated.data);
      }

      console.warn(
        '[ClassificationAgent] Zod validation failed, falling back to defaults:',
        validated.error.issues,
      );
      return SAFE_DEFAULTS;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ClassificationAgent] AI classification failed:', message);
      return SAFE_DEFAULTS;
    }
  }

  /**
   * Rule-based classification without AI.
   * Useful as a fallback or in environments where Bedrock is unavailable.
   */
  classifyWithRules(email: IngestedEmail): EmailClassification {
    const subjectLower = email.subject.toLowerCase();
    const claimRef = extractClaimReference(email.subject);

    // Check each rule in priority order
    for (const rule of CLASSIFICATION_RULES) {
      const matched = rule.keywords.some((keyword) =>
        subjectLower.includes(keyword),
      );

      if (matched) {
        return Object.freeze({
          correspondenceType: rule.type,
          priority: rule.priority,
          existingClaimRef: claimRef,
          isReplyToQuery: false,
          suggestedClient: null,
          confidence: 80,
        });
      }
    }

    // Default classification
    return Object.freeze({
      correspondenceType: 'SUPPORTING_DOC',
      priority: 'normal',
      existingClaimRef: claimRef,
      isReplyToQuery: false,
      suggestedClient: null,
      confidence: 40,
    });
  }
}
