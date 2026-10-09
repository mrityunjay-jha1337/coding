export type CorrespondenceType =
  | 'FNOL'
  | 'MEDICAL_REPORT'
  | 'INVOICE'
  | 'SUPPORTING_DOC'
  | 'QUERY_RESPONSE'
  | 'STATUS_ENQUIRY'
  | 'COMPLAINT'
  | 'SOLICITOR_CORRESPONDENCE'
  | 'THIRD_PARTY'
  | 'NOT_A_CLAIM';

export type Priority = 'urgent' | 'high' | 'normal' | 'low';

export interface EmailAddress {
  name: string;
  email: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  s3Key?: string;
}

export interface IngestedEmail {
  messageId: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  replyTo?: EmailAddress;
  subject: string;
  receivedAt: Date;
  ingestedAt: Date;

  bodyText: string;
  bodyHtml: string;

  attachments: EmailAttachment[];

  // Classification (added by agent)
  correspondenceType?: CorrespondenceType;
  priority?: Priority;
  claimReference?: string | null;
  isReplyToQuery?: boolean;
  isDuplicate?: boolean;
}

export interface EmailClassification {
  correspondenceType: CorrespondenceType;
  priority: Priority;
  existingClaimRef: string | null;
  isReplyToQuery: boolean;
  suggestedClient: string | null;
  confidence: number;
}

export interface GmailFilterRule {
  type: 'sender_domain' | 'subject_keyword' | 'has_attachments' | 'label' | 'exclusion' | 'client_routing' | 'priority';
  value: string;
  action?: string;
}

export interface ConnectorConfig {
  email: string;
  labels: Record<string, string>;
  filterRules: GmailFilterRule[];
  pollingIntervalMs: number;
  autoSendQueries: boolean;
}

export interface IngestionJobData {
  connectorId: string;
  orgId: string;
  messageId: string;
  threadId: string;
}
