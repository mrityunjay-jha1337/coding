import { SendMailClient } from 'zeptomail';
// @ts-ignore
import type { SendMailOptions, Recipient } from 'zeptomail';
import { logger } from '../config/logger';
import { env } from '../config/env';

// ─── Types ─────────────────────────────────────────

export interface SendEmailInput {
  readonly to: string;
  readonly toName?: string;
  readonly from?: string;
  readonly fromName?: string;
  readonly subject: string;
  readonly body: string;
  readonly htmlBody?: string;
  readonly attachments?: ReadonlyArray<{
    filename: string;
    content: Buffer | string;
    contentType: string;
  }>;
  readonly replyTo?: string;
  readonly cc?: ReadonlyArray<string>;
}

export interface SendEmailResult {
  readonly success: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
}

// ─── Constants ─────────────────────────────────────

const DEFAULT_FROM_ADDRESS = env.ZEPTOMAIL_FROM_ADDRESS;
const DEFAULT_FROM_NAME = env.ZEPTOMAIL_FROM_NAME;
const ZEPTOMAIL_URL = env.ZEPTOMAIL_URL;
const ZEPTOMAIL_AUTH_PREFIX = 'Zoho-enczapikey ';

/**
 * ZeptoMail's SDK uses whatever token string is passed in verbatim as the 
 * Authorization header value. We must prefix it with "Zoho-enczapikey ".
 */
function normaliseToken(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  // Send Mail Tokens (sk-...) usually do NOT need the prefix.
  // Account API Keys (enczapikey...) DO need the prefix.
  if (trimmed.startsWith('sk-')) return trimmed;
  if (trimmed.startsWith(ZEPTOMAIL_AUTH_PREFIX)) return trimmed;
  return `${ZEPTOMAIL_AUTH_PREFIX}${trimmed}`;
}

// ─── Service ───────────────────────────────────────

/**
 * Outbound transactional email service backed by ZeptoMail.
 *
 * The ZeptoMail API key is read from process.env.MAIL_KEY. If no key is
 * configured, the service logs a warning and returns a non-throwing failure
 * result from sendEmail() — callers can still persist their correspondence
 * record without the whole pipeline blowing up.
 */
export class EmailSenderService {
  private readonly client: SendMailClient | null;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor() {
    this.fromAddress = DEFAULT_FROM_ADDRESS;
    this.fromName = DEFAULT_FROM_NAME;

    const token = env.MAIL_KEY;
    if (!token) {
      this.client = null;
      logger.warn(
        'MAIL_KEY is not set. ZeptoMail client is disabled; outbound emails will be skipped (records will still be persisted by callers).',
      );
      return;
    }

    this.client = new SendMailClient({
      url: ZEPTOMAIL_URL,
      token: normaliseToken(token),
    });
    logger.info(
      { url: ZEPTOMAIL_URL, from: `${this.fromName} <${this.fromAddress}>` },
      'ZeptoMail transporter initialised',
    );
  }

  // ─── sendEmail ───────────────────────────────────

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.client) {
      const msg = 'ZeptoMail client is not configured (MAIL_KEY missing).';
      logger.warn({ to: input.to, subject: input.subject }, msg);
      return { success: false, messageId: null, error: msg };
    }

    const fromAddress = input.from ?? this.fromAddress;
    const fromName = input.fromName ?? this.fromName;
    const htmlContent = input.htmlBody ?? this.textToHtml(input.body);

    const toRecipients: Recipient[] = [
      {
        email_address: {
          address: input.to,
          name: input.toName ?? input.to,
        },
      },
    ];

    const payload: SendMailOptions = {
      from: { address: fromAddress, name: fromName },
      to: toRecipients,
      subject: input.subject,
      htmlbody: htmlContent,
      textbody: input.body,
    };

    if (input.replyTo) {
      payload.reply_to = [{ address: input.replyTo, name: input.replyTo }];
    }

    if (input.cc && input.cc.length > 0) {
      payload.cc = input.cc.map<Recipient>((address) => ({
        email_address: { address, name: address },
      }));
    }

    if (input.attachments && input.attachments.length > 0) {
      payload.attachments = input.attachments.map((att) => ({
        name: att.filename,
        content:
          typeof att.content === 'string'
            ? Buffer.from(att.content).toString('base64')
            : att.content.toString('base64'),
        mime_type: att.contentType,
      }));
    }

    try {
      const response = await this.client.sendMail(payload) as any;

      const messageId =
        response?.data?.[0]?.message_id ?? response?.request_id ?? 'unknown';

      logger.info(
        { 
          messageId, 
          to: input.to, 
          subject: input.subject,
          status: 'SUCCESS'
        },
        '✅ Email sent successfully via ZeptoMail',
      );

      return { success: true, messageId, error: null };
    } catch (error) {
      const errorMsg = this.describeSendError(error);

      logger.error(
        { 
          error: errorMsg, 
          to: input.to, 
          subject: input.subject,
          status: 'FAILED',
          rawError: typeof error === 'object' ? JSON.stringify(error) : error
        },
        '❌ Failed to send email via ZeptoMail',
      );

      return { success: false, messageId: null, error: errorMsg };
    }
  }

  // ─── describeSendError ───────────────────────────

  /**
   * The ZeptoMail SDK rejects promises with the parsed JSON error body from
   * the API (not an Error instance). Extract the most useful field we can.
   */
  private describeSendError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null) {
      const body = error as {
        error?: { message?: string; details?: unknown[] };
        message?: string;
      };
      if (body.error?.message) return body.error.message;
      if (body.message) return body.message;
      try {
        return JSON.stringify(error);
      } catch {
        return 'Unserialisable ZeptoMail error';
      }
    }
    return 'Unknown ZeptoMail send error';
  }

  // ─── sendClaimCorrespondence ─────────────────────

  async sendClaimCorrespondence(
    claimId: string,
    input: SendEmailInput,
    prisma: any,
  ): Promise<SendEmailResult> {
    const result = await this.sendEmail(input);

    if (result.success) {
      try {
        await prisma.claimCorrespondence.create({
          data: {
            claimId,
            direction: 'OUTBOUND',
            type: 'EMAIL',
            fromEmail: input.from ?? this.fromAddress,
            toEmail: input.to,
            subject: input.subject,
            body: input.body,
            sentAt: new Date(),
          },
        });

        logger.info(
          { claimId, messageId: result.messageId },
          'Claim correspondence recorded',
        );
      } catch (error) {
        const recordError =
          error instanceof Error ? error.message : 'Unknown DB error';

        logger.error(
          { claimId, error: recordError },
          'Email sent but failed to record correspondence',
        );
      }
    }

    return result;
  }

  // ─── textToHtml ──────────────────────────────────

  private textToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const withBreaks = escaped.replace(/\n/g, '<br>');

    return [
      '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #333333; max-width: 600px;">',
      withBreaks,
      '</div>',
    ].join('');
  }
}

// ─── Shared singleton ──────────────────────────────

let sharedInstance: EmailSenderService | null = null;

export function getEmailSenderService(): EmailSenderService {
  if (!sharedInstance) {
    sharedInstance = new EmailSenderService();
  }
  return sharedInstance;
}
