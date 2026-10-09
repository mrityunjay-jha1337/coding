import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    const region = process.env.AWS_REGION || 'us-east-1';

    const config: any = { region };

    // Only set explicit credentials if provided (otherwise use default credential chain)
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
        ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN.trim() } : {}),
      };
    }

    client = new BedrockRuntimeClient(config);
    console.log(`[Bedrock] Client initialized for region: ${region}`);
  }
  return client;
}

// Reset client (useful if credentials expire)
export function resetBedrockClient(): void {
  client = null;
}

export interface BedrockOptions {
  maxTokens?: number;
  temperature?: number;
  modelId?: string;
}

// Model ID priority: Sonnet first for speed, Opus as last resort
const MODEL_PRIORITY = [
  'us.anthropic.claude-sonnet-4-20250514',
  'anthropic.claude-sonnet-4-20250514',
  'us.anthropic.claude-sonnet-4-20250514-v1:0',
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'us.anthropic.claude-opus-4-6-v1',
];

let resolvedModelId: string | null = null;
const STREAM_RETRY_ATTEMPTS = 1;

function isPendingStreamCanceledError(error: any): boolean {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('pending stream has been canceled');
}

async function sendWithRetry(
  bedrockClient: BedrockRuntimeClient,
  command: InvokeModelCommand,
  attempt = 0
): Promise<any> {
  try {
    return await bedrockClient.send(command);
  } catch (error: any) {
    if (isPendingStreamCanceledError(error) && attempt < STREAM_RETRY_ATTEMPTS) {
      console.warn(`[Bedrock] Stream canceled, retrying request (${attempt + 1}/${STREAM_RETRY_ATTEMPTS})...`);
      resetBedrockClient();
      const retryClient = getClient();
      return sendWithRetry(retryClient, command, attempt + 1);
    }
    throw error;
  }
}

export async function invokeBedrockModel(
  prompt: string,
  options: BedrockOptions = {}
): Promise<string> {
  const {
    maxTokens = 4096,
    temperature = 0.3,
    modelId,
  } = options;

  const bedrockClient = getClient();
  const targetModelId = modelId || resolvedModelId || MODEL_PRIORITY[0];

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Try models in priority order if we haven't resolved one yet
  if (!resolvedModelId && !modelId) {
    for (const candidateId of MODEL_PRIORITY) {
      try {
        const command = new InvokeModelCommand({
          modelId: candidateId,
          contentType: 'application/json',
          accept: 'application/json',
          body,
        });

        const response = await sendWithRetry(bedrockClient, command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        resolvedModelId = candidateId;
        console.log(`[Bedrock] Resolved model: ${candidateId}`);
        return responseBody.content?.[0]?.text || '';
      } catch (error: any) {
        if (error.name === 'AccessDeniedException' || error.name === 'ValidationException') {
          console.log(`[Bedrock] Model ${candidateId} not available, trying next...`);
          continue;
        }
        throw error;
      }
    }
    throw new Error('No Bedrock Claude model available. Check your AWS account and region.');
  }

  const command = new InvokeModelCommand({
    modelId: targetModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  });

  const response = await sendWithRetry(bedrockClient, command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content?.[0]?.text || '';
}

export function getResolvedModelId(): string {
  return resolvedModelId || 'not yet resolved';
}
