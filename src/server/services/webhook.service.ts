import { createHmac } from 'crypto';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface WebhookEvent {
  readonly type: string;
  readonly claimId?: string;
  readonly orgId: string;
  readonly data: Record<string, unknown>;
}

export interface WebhookSubscription {
  readonly url: string;
  readonly secret: string;
  readonly events: ReadonlyArray<string>;
  readonly active: boolean;
}

// ─── Constants ─────────────────────────────────────

const HMAC_ALGORITHM = 'sha256';
const SIGNATURE_ENCODING = 'hex' as const;
const WEBHOOK_TIMEOUT_MS = 10000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 10000, 60000]; // 1s, 10s, 60s

// ─── Service ───────────────────────────────────────

export class WebhookService {
  private subscriptions: WebhookSubscription[] = [];

  /**
   * Produce an HMAC-SHA256 signature for webhook payload verification.
   */
  signPayload(payload: string, secret: string): string {
    return createHmac(HMAC_ALGORITHM, secret)
      .update(payload)
      .digest(SIGNATURE_ENCODING);
  }

  /**
   * Add a webhook subscription.
   */
  addSubscription(sub: WebhookSubscription): void {
    this.subscriptions.push(sub);
  }

  /**
   * Remove a subscription by URL.
   */
  removeSubscription(url: string): void {
    this.subscriptions = this.subscriptions.filter(s => s.url !== url);
  }

  /**
   * Get all current subscriptions.
   */
  getSubscriptions(): ReadonlyArray<WebhookSubscription> {
    return [...this.subscriptions];
  }

  /**
   * Dispatch a webhook event to all matching active subscriptions.
   */
  async dispatchEvent(event: WebhookEvent): Promise<void> {
    const matchingSubscriptions = this.subscriptions.filter(
      sub => sub.active && sub.events.includes(event.type),
    );

    for (const sub of matchingSubscriptions) {
      await this.deliverWithRetry(sub, event);
    }
  }

  /**
   * Deliver a webhook event to a single subscription with retry logic.
   */
  private async deliverWithRetry(sub: WebhookSubscription, event: WebhookEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const signature = this.signPayload(payload, sub.secret);

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

        const response = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': event.type,
          },
          body: payload,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          logger.info({ url: sub.url, event: event.type }, 'Webhook delivered');
          return;
        }

        logger.warn({ url: sub.url, status: response.status, attempt }, 'Webhook delivery failed');
      } catch (err: any) {
        logger.warn({ url: sub.url, error: err.message, attempt }, 'Webhook delivery error');
      }

      // Wait before retry (except on last attempt)
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }

    logger.error({ url: sub.url, event: event.type }, 'Webhook delivery failed after all retries');
  }
}
