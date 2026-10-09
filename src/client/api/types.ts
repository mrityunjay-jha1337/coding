export interface PaginatedResponse<T> {
  data?: T[];
  claims?: T[];
  users?: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  specialisation?: string | null;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt?: string | null;
  role: {
    name: string;
    permissions: string[];
  };
  organisation: {
    id: string;
    name: string;
    type: 'BPO' | 'TPA' | 'INSURER' | 'BROKER';
  };
}

export interface ClaimSummary {
  id: string;
  claimReference: string;
  status: string;
  priority: number;
  overallConfidence?: number | null;
  claimant?: { name?: string } | null;
  assignedTo?: string | null;
  teamId?: string | null;
  clientId?: string | null;
  slaDeadline?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  _count: {
    documents: number;
    coding: number;
  };
}

export interface ClaimCodingEntry {
  id: string;
  claimId: string;
  code: string;
  codeType: string;
  description: string;
  llmDescription?: string | null;
  confidence: number;
  evidenceSource?: string | null;
  evidenceTranslated?: string | null;
  pageNumber?: number | null;
  section?: string | null;
  pathUsed?: string | null;
  isValidated: boolean;
  needsReview: boolean;
  isPrimary: boolean;
  reasoning?: string | null;
  reviewerId?: string | null;
  reviewerAction?: string | null;
  reviewerNote?: string | null;
  originalCode?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface ClaimDocument {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  docType: string;
  language?: string | null;
  pageCount?: number | null;
  extractionConfidence?: number | null;
  processingStatus?: string | null;
  createdAt: string;
}

export interface ClaimCorrespondence {
  id: string;
  direction: string;
  type: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  sentAt?: string | null;
  createdAt: string;
}

export interface ClaimEscalation {
  id: string;
  tier: string;
  reason: string;
  resolution?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface ClaimDetailRecord extends ClaimSummary {
  claimant?: Record<string, unknown> | null;
  policy?: Record<string, unknown> | null;
  incident?: Record<string, unknown> | null;
  treatment?: Record<string, unknown> | null;
  financials?: Record<string, unknown> | null;
  coverageAnalysis?: Record<string, unknown> | null;
  processingTimeMs?: number | null;
  errors?: string[];
  documents: ClaimDocument[];
  coding: ClaimCodingEntry[];
  correspondence: ClaimCorrespondence[];
  escalations: ClaimEscalation[];
  assignedHandler?: { id: string; name: string; email: string } | null;
  team?: { id: string; name: string } | null;
  client?: { id: string; name: string } | null;
}

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  channel: string;
  data: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  eventType: string;
  actorType: string;
  actorId?: string | null;
  targetType: string;
  targetId?: string | null;
  action: string;
  details: Record<string, unknown>;
  previousValue?: any;
  newValue?: any;
  createdAt: string;
  actor?: { id: string; name: string; email: string } | null;
  claim?: { id: string; claimReference: string } | null;
}

export interface QueueCounts {
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
  paused?: number;
}

export interface QueueStats {
  ingestion: QueueCounts;
  processing: QueueCounts;
  correspondence: QueueCounts;
  notification: QueueCounts;
}
