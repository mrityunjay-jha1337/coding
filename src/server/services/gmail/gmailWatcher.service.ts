import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { GmailConnectorService } from './gmailConnector.service';
import { ingestionQueue } from '../../queues/index';

const connectorService = new GmailConnectorService(prisma);

interface HistoryFetchResult {
  messages: Array<{ id: string; threadId: string }>;
  latestHistoryId: string | null;
}

/**
 * Handles a Pub/Sub push notification from Gmail.
 * Called by the webhook endpoint when Google pushes a notification.
 */
export async function handlePubSubNotification(data: {
  emailAddress: string;
  historyId: string;
}): Promise<{ processed: number }> {
  const { emailAddress, historyId } = data;

  logger.info({ emailAddress, historyId }, 'Received Gmail Pub/Sub notification');

  const connector = await prisma.gmailConnector.findFirst({
    where: { email: emailAddress, status: 'CONNECTED' },
  });

  if (!connector) {
    logger.warn({ emailAddress }, 'No active connector found for email');
    return { processed: 0 };
  }

  const accessToken = await connectorService.getAccessToken(connector.id);
  const { messages, latestHistoryId } = await fetchHistoryChanges(
    accessToken,
    connector.historyId || historyId
  );

  let processed = 0;
  for (const msg of messages) {
    await ingestionQueue.add(
      'ingest-email',
      {
        connectorId: connector.id,
        orgId: connector.orgId,
        messageId: msg.id,
        threadId: msg.threadId,
      },
      {
        jobId: `gmail-${msg.id}`, // Prevent duplicate jobs
      }
    );
    processed++;
  }

  // Advance the cursor to the notification's historyId so the next push starts from here
  await connectorService.updateLastSync(connector.id, latestHistoryId || historyId);

  logger.info({ emailAddress, processed, historyId }, 'Pub/Sub notification processed');
  return { processed };
}

/**
 * Fetches new messages from Gmail using the history API.
 */
async function fetchHistoryChanges(
  accessToken: string,
  startHistoryId: string
): Promise<HistoryFetchResult> {
  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // historyId expired — fall back to a recent-message scan
        const messages = await fetchRecentMessages(accessToken);
        return { messages, latestHistoryId: null };
      }
      throw new Error(`Gmail history API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.history) {
      return { messages: [], latestHistoryId: data.historyId || null };
    }

    const messages: Array<{ id: string; threadId: string }> = [];
    const seen = new Set<string>();

    for (const entry of data.history) {
      if (entry.messagesAdded) {
        for (const added of entry.messagesAdded) {
          if (!seen.has(added.message.id)) {
            seen.add(added.message.id);
            messages.push({
              id: added.message.id,
              threadId: added.message.threadId,
            });
          }
        }
      }
    }

    return { messages, latestHistoryId: data.historyId || null };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch Gmail history');
    throw error;
  }
}

/**
 * Fallback: fetch recent messages when the stored historyId has expired.
 */
async function fetchRecentMessages(
  accessToken: string
): Promise<Array<{ id: string; threadId: string }>> {
  const url =
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=newer_than:1d';
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Gmail messages API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.messages || []).map((m: any) => ({ id: m.id, threadId: m.threadId }));
}

/**
 * Sets up Gmail push notifications via Pub/Sub watch.
 * Must be called after a connector is created and again before expiry (7 days max).
 */
export async function setupGmailWatch(
  connectorId: string,
  topicName: string
): Promise<{ historyId: string; expiration: string }> {
  const accessToken = await connectorService.getAccessToken(connectorId);

  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/watch';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topicName,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail watch setup failed: ${response.status} - ${text}`);
  }

  const data = await response.json();

  await prisma.gmailConnector.update({
    where: { id: connectorId },
    data: {
      historyId: data.historyId,
      pubsubExpiry: new Date(parseInt(data.expiration, 10)),
    },
  });

  logger.info(
    { connectorId, historyId: data.historyId, expiration: data.expiration },
    'Gmail watch registered'
  );

  return { historyId: data.historyId, expiration: data.expiration };
}

/**
 * Stops Gmail push notifications for a connector.
 * Call this on disconnect so Google stops publishing to Pub/Sub.
 */
export async function stopGmailWatch(connectorId: string): Promise<void> {
  try {
    const accessToken = await connectorService.getAccessToken(connectorId);
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      logger.warn({ connectorId, status: response.status, text }, 'Gmail stop watch failed');
    }
  } catch (error: any) {
    logger.warn({ connectorId, error: error.message }, 'Failed to stop Gmail watch');
  }
}

/**
 * Renews Gmail watch subscriptions that are close to expiry.
 * Gmail watches expire after 7 days; we refresh anything within a day of expiring.
 */
export async function renewExpiringWatches(): Promise<{ renewed: number; failed: number }> {
  const topicName = env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    logger.debug('GMAIL_PUBSUB_TOPIC not configured, skipping watch renewal');
    return { renewed: 0, failed: 0 };
  }

  const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000); // next 24 hours
  const connectors = await prisma.gmailConnector.findMany({
    where: {
      status: 'CONNECTED',
      OR: [{ pubsubExpiry: null }, { pubsubExpiry: { lte: threshold } }],
    },
    select: { id: true, email: true },
  });

  let renewed = 0;
  let failed = 0;

  for (const connector of connectors) {
    try {
      await setupGmailWatch(connector.id, topicName);
      renewed++;
    } catch (error: any) {
      failed++;
      logger.error(
        { connectorId: connector.id, email: connector.email, error: error.message },
        'Gmail watch renewal failed'
      );
      if (error.message.includes('401') || error.message.includes('403')) {
        await connectorService.updateStatus(connector.id, 'AUTH_EXPIRED');
      }
    }
  }

  if (renewed > 0 || failed > 0) {
    logger.info({ renewed, failed }, 'Gmail watch renewal pass complete');
  }

  return { renewed, failed };
}
