import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

const S3_BUCKET = 'quickintell-rcm';
const S3_KEY = 'icd10json/icd10-codes.json';
const LOCAL_PATH = '/tmp/icd10-codes.json';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const region = process.env.AWS_REGION || 'us-east-1';
    const config: any = { region };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
        ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN.trim() } : {}),
      };
    }

    s3Client = new S3Client(config);
  }
  return s3Client;
}

/**
 * Download icd10-codes.json from S3 to /tmp/.
 * Returns the local file path on success.
 * Falls back to the bundled file if S3 fetch fails.
 */
export async function fetchICD10FromS3(): Promise<string> {
  // If file already exists in /tmp, skip download
  if (fs.existsSync(LOCAL_PATH)) {
    console.log(`[S3 Loader] ICD-10 data already cached at ${LOCAL_PATH}`);
    return LOCAL_PATH;
  }

  console.log(`[S3 Loader] Fetching s3://${S3_BUCKET}/${S3_KEY} ...`);

  try {
    const client = getS3Client();
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: S3_KEY });
    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('Empty response body from S3');
    }

    // Stream the S3 object body to a string, then write to disk
    const bodyString = await response.Body.transformToString('utf-8');

    // Validate it's parseable JSON before writing
    JSON.parse(bodyString);

    fs.writeFileSync(LOCAL_PATH, bodyString, 'utf-8');
    console.log(`[S3 Loader] ICD-10 data saved to ${LOCAL_PATH} (${(bodyString.length / 1024 / 1024).toFixed(1)} MB)`);
    return LOCAL_PATH;
  } catch (error: any) {
    console.error(`[S3 Loader] Failed to fetch from S3: ${error.message}`);

    // Fallback to bundled file
    const bundledPath = path.resolve(__dirname, '../data/icd10-codes.json');
    if (fs.existsSync(bundledPath)) {
      console.log(`[S3 Loader] Falling back to bundled file: ${bundledPath}`);
      return bundledPath;
    }

    throw new Error(`ICD-10 data unavailable: S3 fetch failed and no bundled file found`);
  }
}

/**
 * Get the path to the ICD-10 codes JSON file.
 * Prefers /tmp (S3-fetched), falls back to bundled.
 */
export function getICD10DataPath(): string {
  if (fs.existsSync(LOCAL_PATH)) {
    return LOCAL_PATH;
  }
  return path.resolve(__dirname, '../data/icd10-codes.json');
}
