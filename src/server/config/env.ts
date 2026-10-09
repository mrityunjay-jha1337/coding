import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Normalize empty strings to undefined so z.default() works
function cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(env)) {
    cleaned[key] = val === '' ? undefined : val;
  }
  return cleaned;
}

const cleanedEnv = cleanEnv(process.env as Record<string, string | undefined>);
const nodeEnv = cleanedEnv.NODE_ENV ?? 'development';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  JWT_ACCESS_SECRET:
    nodeEnv === 'development'
      ? z.string().min(16).default('localdev-access-secret-12345')
      : z.string().min(16),
  JWT_REFRESH_SECRET:
    nodeEnv === 'development'
      ? z.string().min(16).default('localdev-refresh-secret-12345')
      : z.string().min(16),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PII_ENCRYPTION_KEY:
    nodeEnv === 'development'
      ? z.string().min(16).default('localdev-pii-encryption-key-12345')
      : z.string().min(16).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  // Gmail Pub/Sub push notifications
  GMAIL_PUBSUB_TOPIC: z.string().optional(), // e.g. projects/<project>/topics/<topic>
  GMAIL_PUBSUB_VERIFICATION_TOKEN: z.string().optional(), // shared secret in push URL ?token=
  GMAIL_WATCH_RENEWAL_INTERVAL_MS: z.coerce.number().default(6 * 60 * 60 * 1000), // 6h
  S3_BUCKET_DOCUMENTS: z.string().default('claimsintell-documents'),
  // ── ZeptoMail (outbound transactional email) ──
  MAIL_KEY: z.string().optional(),
  ZEPTOMAIL_URL: z.string().default('https://api.zeptomail.in/v1.1/email'),
  ZEPTOMAIL_FROM_ADDRESS: z.string().default('noreply@hi.quickintell.com'),
  ZEPTOMAIL_FROM_NAME: z.string().default('QuickIntell Claims'),
});

export const env = envSchema.parse(cleanedEnv);
export type Env = z.infer<typeof envSchema>;
