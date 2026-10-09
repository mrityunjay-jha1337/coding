export const MAX_CONCURRENT_SESSIONS = 3;
export const BCRYPT_ROUNDS = 12;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_HISTORY_SIZE = 12;
export const PASSWORD_ROTATION_DAYS = 90;

export const LOGIN_LOCKOUT_ATTEMPTS_TIER1 = 5;
export const LOGIN_LOCKOUT_DURATION_TIER1_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_LOCKOUT_ATTEMPTS_TIER2 = 10;
export const LOGIN_LOCKOUT_DURATION_TIER2_MS = 60 * 60 * 1000; // 1 hour

export const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes

export const EMAIL_OTP_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
export const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
export const INVITE_LINK_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

export const SYSTEM_ROLES = ['SUPER_ADMIN', 'BPO_ADMIN', 'TEAM_LEAD', 'BPO_USER', 'CLIENT'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];
