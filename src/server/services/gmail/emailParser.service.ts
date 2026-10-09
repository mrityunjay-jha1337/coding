import type { IngestedEmail, EmailAddress, EmailAttachment } from '../../../shared/emailTypes';

// ─── HTML ENTITY MAP ────────────────────────────────────

const HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#x2F;': '/',
  '&#x27;': "'",
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
  '&hellip;': '\u2026',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
});

const HTML_ENTITY_PATTERN = new RegExp(
  Object.keys(HTML_ENTITIES).join('|') + '|&#(\\d+);|&#x([0-9a-fA-F]+);',
  'gi',
);

// ─── EMAIL ADDRESS PARSING ──────────────────────────────

const EMAIL_WITH_NAME_REGEX = /^(.+?)\s*<([^>]+)>$/;
const BARE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse an email header value like "John Smith <john@example.com>" or "john@example.com"
 * into a structured { name, email } object.
 */
export function extractEmailAddress(raw: string): EmailAddress {
  const trimmed = raw.trim();
  const namedMatch = trimmed.match(EMAIL_WITH_NAME_REGEX);

  if (namedMatch) {
    return Object.freeze({
      name: namedMatch[1].replace(/^["']|["']$/g, '').trim(),
      email: namedMatch[2].trim().toLowerCase(),
    });
  }

  if (BARE_EMAIL_REGEX.test(trimmed)) {
    return Object.freeze({
      name: '',
      email: trimmed.toLowerCase(),
    });
  }

  // Fallback: treat entire value as the email (best effort)
  return Object.freeze({ name: '', email: trimmed.toLowerCase() });
}

/**
 * Parse a comma-separated list of addresses (e.g. To/Cc header).
 */
function parseAddressList(raw: string | undefined): readonly EmailAddress[] {
  if (!raw || raw.trim().length === 0) return Object.freeze([]);

  return Object.freeze(
    raw.split(',').map((part) => extractEmailAddress(part)),
  );
}

// ─── HTML STRIPPING ─────────────────────────────────────

/**
 * Strip HTML tags and decode common HTML entities to produce plain text.
 */
export function stripHtml(html: string): string {
  // Remove style and script blocks entirely
  let text = html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Replace <br> and block-level closing tags with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode HTML entities
  text = text.replace(HTML_ENTITY_PATTERN, (match, decNum, hexNum) => {
    if (decNum !== undefined) return String.fromCharCode(parseInt(decNum, 10));
    if (hexNum !== undefined) return String.fromCharCode(parseInt(hexNum, 16));
    return HTML_ENTITIES[match.toLowerCase()] ?? match;
  });
  // Collapse excessive whitespace but preserve single newlines
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
  // Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// ─── GMAIL PAYLOAD HELPERS ──────────────────────────────

interface GmailHeader {
  readonly name: string;
  readonly value: string;
}

interface GmailPart {
  readonly partId?: string;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly headers?: readonly GmailHeader[];
  readonly body?: {
    readonly attachmentId?: string;
    readonly size?: number;
    readonly data?: string;
  };
  readonly parts?: readonly GmailPart[];
}

interface GmailPayload extends GmailPart {
  readonly headers?: readonly GmailHeader[];
}

interface GmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly payload: GmailPayload;
  readonly internalDate?: string;
}

function getHeader(
  headers: readonly GmailHeader[] | undefined,
  name: string,
): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found?.value ?? '';
}

/**
 * Decode base64url-encoded data from the Gmail API body.
 */
function decodeBase64Url(data: string): string {
  // Gmail API uses URL-safe base64: replace - with + and _ with /
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// ─── RECURSIVE PART COLLECTION ──────────────────────────

interface CollectedParts {
  readonly textPlain: string;
  readonly textHtml: string;
  readonly attachments: readonly EmailAttachment[];
}

const EMPTY_COLLECTED: CollectedParts = Object.freeze({
  textPlain: '',
  textHtml: '',
  attachments: Object.freeze([]),
});

/**
 * Recursively walk MIME parts to extract text bodies and attachment metadata.
 */
function collectParts(part: GmailPart): CollectedParts {
  const mime = (part.mimeType ?? '').toLowerCase();

  // Leaf node with body data (text/plain or text/html)
  if (mime === 'text/plain' && part.body?.data) {
    return { ...EMPTY_COLLECTED, textPlain: decodeBase64Url(part.body.data) };
  }
  if (mime === 'text/html' && part.body?.data) {
    return { ...EMPTY_COLLECTED, textHtml: decodeBase64Url(part.body.data) };
  }

  // Attachment leaf (has filename or attachmentId)
  if (part.filename && part.filename.length > 0) {
    const attachment: EmailAttachment = Object.freeze({
      id: part.body?.attachmentId ?? part.partId ?? '',
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body?.size ?? 0,
    });
    return {
      ...EMPTY_COLLECTED,
      attachments: Object.freeze([attachment]),
    };
  }

  // Multipart container — recurse into children
  if (part.parts && part.parts.length > 0) {
    return part.parts.reduce<CollectedParts>((acc, child) => {
      const childResult = collectParts(child);
      return Object.freeze({
        textPlain: acc.textPlain || childResult.textPlain,
        textHtml: acc.textHtml || childResult.textHtml,
        attachments: Object.freeze([...acc.attachments, ...childResult.attachments]),
      });
    }, EMPTY_COLLECTED);
  }

  return EMPTY_COLLECTED;
}

// ─── EMAIL PARSER SERVICE ───────────────────────────────

export class EmailParserService {
  /**
   * Parse a raw Gmail API message response into a fully populated IngestedEmail.
   */
  parseGmailMessage(rawMessage: GmailMessage): IngestedEmail {
    if (!rawMessage?.payload) {
      throw new Error('Invalid Gmail message: missing payload');
    }

    const { payload } = rawMessage;
    const headers = payload.headers ?? [];

    const subject = getHeader(headers, 'Subject');
    const fromRaw = getHeader(headers, 'From');
    const toRaw = getHeader(headers, 'To');
    const ccRaw = getHeader(headers, 'Cc');
    const replyToRaw = getHeader(headers, 'Reply-To');
    const dateRaw = getHeader(headers, 'Date');

    const collected = collectParts(payload);

    const bodyText = collected.textPlain || stripHtml(collected.textHtml);
    const bodyHtml = collected.textHtml;

    const receivedAt = rawMessage.internalDate
      ? new Date(parseInt(rawMessage.internalDate, 10))
      : dateRaw
        ? new Date(dateRaw)
        : new Date();

    const email: IngestedEmail = Object.freeze({
      messageId: rawMessage.id,
      threadId: rawMessage.threadId,
      from: extractEmailAddress(fromRaw),
      to: [...parseAddressList(toRaw)],
      cc: [...parseAddressList(ccRaw)],
      ...(replyToRaw ? { replyTo: extractEmailAddress(replyToRaw) } : {}),
      subject,
      receivedAt,
      ingestedAt: new Date(),
      bodyText,
      bodyHtml,
      attachments: [...collected.attachments],
    });

    return email;
  }
}
