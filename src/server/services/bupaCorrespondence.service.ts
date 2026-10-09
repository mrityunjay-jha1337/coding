import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { invokeBedrockModel } from './bedrockClient';
import { getEmailSenderService } from './emailSender.service';
import { env } from '../config/env';

// ─── Types ─────────────────────────────────────────

export type CorrespondenceType =
  | 'CLAIM_ACKNOWLEDGEMENT'
  | 'MISSING_INFO_REQUEST'
  | 'PRE_AUTH_REMINDER'
  | 'BANK_DETAILS_REQUEST'
  | 'MEDICAL_QUERY'
  | 'APPROVAL_NOTIFICATION'
  | 'DENIAL_NOTIFICATION'
  | 'PARTIAL_APPROVAL'
  | 'EXPLANATION_OF_BENEFITS'
  | 'FOLLOW_UP_REMINDER'
  | 'STATUS_UPDATE';

export interface GenerateCorrespondenceInput {
  readonly claimId: string;
  readonly claimReference: string;
  readonly correspondenceType: CorrespondenceType;
  readonly recipientEmail: string;
  readonly recipientName: string;
  readonly recipientLanguage: string;
  readonly membershipNumber?: string;
  readonly treatmentDate?: string;
  readonly facilityName?: string;
  readonly claimAmount?: number;
  readonly currency?: string;
  readonly missingFields?: string[];
  readonly denialReasons?: string[];
  readonly payableAmount?: number;
  readonly eobSummary?: string;
  readonly additionalContext?: string;
}

export interface GeneratedCorrespondence {
  readonly subject: string;
  readonly body: string;
  readonly originalSubject: string;
  readonly originalBody: string;
  readonly language: string;
  readonly wasTranslated: boolean;
}

// ─── Constants ─────────────────────────────────────

const BUPA_FROM_EMAIL = env.ZEPTOMAIL_FROM_ADDRESS;
const BUPA_PHONE = '+44 (0) 1273 323 563';
const BUPA_PORTAL = 'www.bupaglobal.com/membersworld';
const BUPA_INFO_EMAIL = 'info@bupaglobal.com';

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  zh: 'Chinese',
  ar: 'Arabic',
  ja: 'Japanese',
  fr: 'French',
  hi: 'Hindi',
  de: 'German',
  es: 'Spanish',
  ko: 'Korean',
  th: 'Thai',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
};

// ─── Templates ─────────────────────────────────────

interface TemplateDefinition {
  readonly subject: string;
  readonly body: string;
}

const TEMPLATES: Readonly<Record<CorrespondenceType, TemplateDefinition>> = {
  CLAIM_ACKNOWLEDGEMENT: {
    subject: '[{{claimReference}}] Your Bupa Global claim has been received',
    body: `Dear {{recipientName}},

Thank you for submitting your claim (ref: {{claimReference}}).

We have received your claim for treatment at {{facilityName}} on {{treatmentDate}} for the amount of {{currency}} {{claimAmount}}.

Your claim is now being processed. You can track the progress at ${BUPA_PORTAL} or contact us at ${BUPA_PHONE}.

We aim to process your claim within 5 business days.

Kind regards,
Bupa Global Claims Team`,
  },

  MISSING_INFO_REQUEST: {
    subject:
      '[{{claimReference}}] Additional information required for your claim',
    body: `Dear {{recipientName}},

We are processing your claim (ref: {{claimReference}}) and need the following information to proceed:

{{#each missingFields}}
\u2022 {{this}}
{{/each}}

Please reply to this email with the requested information or update your details at ${BUPA_PORTAL}

If we do not receive a response within 10 business days, we may be unable to process your claim.

Kind regards,
Bupa Global Claims Team`,
  },

  PRE_AUTH_REMINDER: {
    subject:
      '[{{claimReference}}] Pre-authorisation reminder for your treatment',
    body: `Dear {{recipientName}},

We are writing regarding your claim (ref: {{claimReference}}).

Please note that pre-authorisation is required for your planned treatment at {{facilityName}}. To avoid delays in processing your claim, please ensure that pre-authorisation is obtained before proceeding with treatment.

You can submit a pre-authorisation request via ${BUPA_PORTAL} or by contacting us at ${BUPA_PHONE}.

If pre-authorisation has already been obtained, please disregard this reminder.

Kind regards,
Bupa Global Claims Team`,
  },

  BANK_DETAILS_REQUEST: {
    subject:
      '[{{claimReference}}] Bank details required for claim payment',
    body: `Dear {{recipientName}},

Your claim (ref: {{claimReference}}) has been processed and payment is ready to be issued.

However, we do not have valid bank details on file to complete the payment of {{currency}} {{payableAmount}}.

Please provide your bank details by replying to this email or updating them at ${BUPA_PORTAL}

We require the following:
\u2022 Account holder name
\u2022 Bank name
\u2022 Account number / IBAN
\u2022 Sort code / SWIFT/BIC

Kind regards,
Bupa Global Claims Team`,
  },

  MEDICAL_QUERY: {
    subject: '[{{claimReference}}] Medical information required for your claim',
    body: `Dear {{recipientName}},

We are reviewing your claim (ref: {{claimReference}}) and require additional medical information to complete our assessment.

{{#each missingFields}}
\u2022 {{this}}
{{/each}}

Please arrange for your treating physician at {{facilityName}} to provide the requested information, or reply to this email with the relevant medical documentation.

If we do not receive a response within 10 business days, we will proceed with our assessment based on the information currently available.

Kind regards,
Bupa Global Claims Team`,
  },

  APPROVAL_NOTIFICATION: {
    subject: '[{{claimReference}}] Your Bupa Global claim has been approved',
    body: `Dear {{recipientName}},

We are pleased to inform you that your claim (ref: {{claimReference}}) has been approved.

Claim Amount: {{currency}} {{claimAmount}}
Approved Amount: {{currency}} {{payableAmount}}

Payment will be processed within 5-7 business days.

Kind regards,
Bupa Global Claims Team`,
  },

  DENIAL_NOTIFICATION: {
    subject: '[{{claimReference}}] Your Bupa Global claim decision',
    body: `Dear {{recipientName}},

We have reviewed your claim (ref: {{claimReference}}) and unfortunately, we are unable to approve it for the following reason(s):

{{#each denialReasons}}
\u2022 {{this}}
{{/each}}

If you believe this decision is incorrect, you have the right to appeal. Please contact us at ${BUPA_PHONE} or email ${BUPA_INFO_EMAIL} within 30 days of this notification.

Kind regards,
Bupa Global Claims Team`,
  },

  PARTIAL_APPROVAL: {
    subject:
      '[{{claimReference}}] Your Bupa Global claim \u2014 partial approval',
    body: `Dear {{recipientName}},

We have completed the assessment of your claim (ref: {{claimReference}}).

Your claim has been partially approved with the following details:

Claimed Amount: {{currency}} {{claimAmount}}
Approved Amount: {{currency}} {{payableAmount}}

{{eobSummary}}

Payment of the approved amount will be processed within 5-7 business days.

If you have questions about this decision or wish to appeal, please contact us at ${BUPA_PHONE} or email ${BUPA_INFO_EMAIL} within 30 days.

Kind regards,
Bupa Global Claims Team`,
  },

  EXPLANATION_OF_BENEFITS: {
    subject:
      '[{{claimReference}}] Explanation of Benefits for your claim',
    body: `Dear {{recipientName}},

Please find below the Explanation of Benefits (EOB) for your claim (ref: {{claimReference}}).

Claimed Amount: {{currency}} {{claimAmount}}
Approved Amount: {{currency}} {{payableAmount}}

Summary:
{{eobSummary}}

If you have any questions about this statement, please contact us at ${BUPA_PHONE} or visit ${BUPA_PORTAL}.

Kind regards,
Bupa Global Claims Team`,
  },

  FOLLOW_UP_REMINDER: {
    subject: '[{{claimReference}}] Reminder: outstanding information for your claim',
    body: `Dear {{recipientName}},

We previously contacted you regarding your claim (ref: {{claimReference}}) requesting additional information.

We have not yet received your response. To avoid delays in processing your claim, please provide the outstanding information as soon as possible by replying to this email or visiting ${BUPA_PORTAL}.

If we do not receive a response within 5 business days, we may need to make a decision based on the information currently available.

Kind regards,
Bupa Global Claims Team`,
  },

  STATUS_UPDATE: {
    subject: '[{{claimReference}}] Update on your Bupa Global claim',
    body: `Dear {{recipientName}},

We are writing to provide you with an update on your claim (ref: {{claimReference}}).

{{additionalContext}}

You can track the latest status of your claim at ${BUPA_PORTAL} or contact us at ${BUPA_PHONE}.

Kind regards,
Bupa Global Claims Team`,
  },
};

// ─── Service ───────────────────────────────────────

export class BupaCorrespondenceService {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── generateCorrespondence ──────────────────────

  async generateCorrespondence(
    input: GenerateCorrespondenceInput,
  ): Promise<GeneratedCorrespondence> {
    const template = TEMPLATES[input.correspondenceType];
    if (!template) {
      throw new Error(
        `Unknown correspondence type: ${input.correspondenceType}`,
      );
    }

    const variables = this.buildVariables(input);
    const originalSubject = this.renderTemplate(template.subject, variables);
    const originalBody = this.renderTemplate(template.body, variables);

    const needsTranslation = input.recipientLanguage !== 'en';

    if (!needsTranslation) {
      return {
        subject: originalSubject,
        body: originalBody,
        originalSubject,
        originalBody,
        language: 'en',
        wasTranslated: false,
      };
    }

    const translatedSubject = await this.translateToLanguage(
      originalSubject,
      input.recipientLanguage,
    );
    const translatedBody = await this.translateToLanguage(
      originalBody,
      input.recipientLanguage,
    );

    logger.info(
      {
        claimId: input.claimId,
        correspondenceType: input.correspondenceType,
        targetLanguage: input.recipientLanguage,
      },
      'Correspondence translated',
    );

    return {
      subject: translatedSubject,
      body: translatedBody,
      originalSubject,
      originalBody,
      language: input.recipientLanguage,
      wasTranslated: true,
    };
  }

  // ─── sendAndRecord ──────────────────────────────

  async sendAndRecord(input: GenerateCorrespondenceInput): Promise<string> {
    const correspondence = await this.generateCorrespondence(input);

    // 1. Attempt delivery via ZeptoMail. A failure here must NOT prevent
    //    the audit record from being persisted — the claim pipeline still
    //    needs a trail of what we tried to send.
    const emailSender = getEmailSenderService();
    const sendResult = await emailSender.sendEmail({
      to: input.recipientEmail,
      toName: input.recipientName,
      subject: correspondence.subject,
      body: correspondence.body,
    });

    // 2. Persist the correspondence record with the actual send outcome.
    const record = await this.prisma.claimCorrespondence.create({
      data: {
        claimId: input.claimId,
        direction: 'OUTBOUND',
        type: input.correspondenceType,
        fromEmail: BUPA_FROM_EMAIL,
        toEmail: input.recipientEmail,
        subject: correspondence.subject,
        body: correspondence.body,
        sentAt: sendResult.success ? new Date() : null,
      },
    });

    logger.info(
      {
        correspondenceId: record.id,
        claimId: input.claimId,
        type: input.correspondenceType,
        language: correspondence.language,
        wasTranslated: correspondence.wasTranslated,
        delivered: sendResult.success,
        messageId: sendResult.messageId,
        sendError: sendResult.error,
      },
      sendResult.success
        ? 'Outbound correspondence sent and recorded'
        : 'Outbound correspondence recorded but delivery failed/skipped',
    );

    return record.id;
  }

  // ─── Private: translateToLanguage ────────────────

  private async translateToLanguage(
    text: string,
    targetLanguage: string,
  ): Promise<string> {
    const languageName =
      LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

    const prompt = [
      `Translate the following professional insurance correspondence to ${languageName}.`,
      'Preserve all reference numbers, amounts, dates, and proper nouns.',
      'Maintain a professional, empathetic tone.',
      'Return ONLY the translated text with no additional commentary.',
      '',
      text,
    ].join('\n');

    try {
      const translated = await invokeBedrockModel(prompt);
      return translated.trim();
    } catch (error) {
      logger.error(
        { targetLanguage, error },
        'Translation failed, returning original text',
      );
      return text;
    }
  }

  // ─── Private: renderTemplate ─────────────────────

  private renderTemplate(
    template: string,
    variables: Readonly<Record<string, string | number | string[]>>,
  ): string {
    // Process {{#each array}} ... {{/each}} blocks
    const withEach = template.replace(
      /\{\{#each (\w+)\}\}\n?([\s\S]*?)\{\{\/each\}\}/g,
      (_match, key: string, itemTemplate: string) => {
        const value = variables[key];
        if (!Array.isArray(value)) {
          return '';
        }
        return value
          .map((item) => itemTemplate.replace(/\{\{this\}\}/g, item))
          .join('');
      },
    );

    // Replace simple {{variable}} placeholders
    return withEach.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = variables[key];
      if (value === undefined || value === null) {
        return '';
      }
      if (Array.isArray(value)) {
        return value.join(', ');
      }
      return String(value);
    });
  }

  // ─── Private: buildVariables ─────────────────────

  private buildVariables(
    input: GenerateCorrespondenceInput,
  ): Readonly<Record<string, string | number | string[]>> {
    const vars: Record<string, string | number | string[]> = {
      claimReference: input.claimReference,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
    };

    if (input.membershipNumber !== undefined) {
      vars.membershipNumber = input.membershipNumber;
    }
    if (input.treatmentDate !== undefined) {
      vars.treatmentDate = input.treatmentDate;
    }
    if (input.facilityName !== undefined) {
      vars.facilityName = input.facilityName;
    }
    if (input.claimAmount !== undefined) {
      vars.claimAmount = input.claimAmount;
    }
    if (input.currency !== undefined) {
      vars.currency = input.currency;
    }
    if (input.missingFields !== undefined) {
      vars.missingFields = input.missingFields;
    }
    if (input.denialReasons !== undefined) {
      vars.denialReasons = input.denialReasons;
    }
    if (input.payableAmount !== undefined) {
      vars.payableAmount = input.payableAmount;
    }
    if (input.eobSummary !== undefined) {
      vars.eobSummary = input.eobSummary;
    }
    if (input.additionalContext !== undefined) {
      vars.additionalContext = input.additionalContext;
    }

    return vars;
  }
}
