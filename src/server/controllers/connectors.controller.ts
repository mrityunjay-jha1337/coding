import { Request, Response, NextFunction } from 'express';
import { GmailConnectorService } from '../services/gmail/gmailConnector.service';
import {
  handlePubSubNotification,
  setupGmailWatch,
  stopGmailWatch,
} from '../services/gmail/gmailWatcher.service';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { env } from '../config/env';

const connectorService = new GmailConnectorService(prisma);

async function registerWatch(connectorId: string): Promise<void> {
  if (!env.GMAIL_PUBSUB_TOPIC) {
    logger.warn(
      { connectorId },
      'GMAIL_PUBSUB_TOPIC not configured — connector stored but Pub/Sub watch not registered'
    );
    return;
  }
  try {
    await setupGmailWatch(connectorId, env.GMAIL_PUBSUB_TOPIC);
  } catch (error: any) {
    logger.error(
      { connectorId, error: error.message },
      'Failed to register Gmail watch after OAuth'
    );
  }
}

export async function listConnectors(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const connectors = await connectorService.listConnectors(req.user.orgId);
    res.status(200).json(connectors);
  } catch (err) { next(err); }
}

export async function initiateOAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const url = connectorService.generateAuthUrl(req.user.orgId);
    res.status(200).json({ authUrl: url });
  } catch (err: any) {
    if (err.message?.includes('Google OAuth is not configured')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleOAuthCallback(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, state: orgId } = req.query as { code: string; state: string };
    if (!code || !orgId) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    // Exchange code for tokens
    const tokenData = await connectorService.exchangeCodeForTokens(code);

    // Store connector in database
    const connector = await connectorService.storeConnector(orgId, tokenData);

    // Register Gmail Pub/Sub watch so Google pushes new-message notifications to us
    await registerWatch(connector.id);

    // Redirect back to frontend connectors page with success
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/app/connectors?status=connected&email=${encodeURIComponent(tokenData.email)}`);
  } catch (err: any) {
    logger.error({ error: err.message }, 'OAuth callback failed');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/app/connectors?status=error&message=${encodeURIComponent(err.message)}`);
  }
}

export async function getConnectorStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const connector = await connectorService.getConnectorById(req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    res.status(200).json(connector);
  } catch (err) { next(err); }
}

export async function disconnectConnector(req: Request, res: Response, next: NextFunction) {
  try {
    // Best-effort: tell Gmail to stop pushing notifications before we delete tokens
    await stopGmailWatch(req.params.id);
    await connectorService.disconnectConnector(req.params.id);
    res.status(200).json({ message: 'Connector disconnected' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    next(err);
  }
}

export async function updateFilterRules(req: Request, res: Response, next: NextFunction) {
  try {
    const { rules } = req.body;
    const updated = await connectorService.updateFilterRules(req.params.id, rules);
    res.status(200).json(updated);
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    next(err);
  }
}

export async function webhookHandler(req: Request, res: Response) {
  // Google Pub/Sub push payload: { message: { data: base64(...), messageId, publishTime }, subscription }
  try {
    // Verify shared secret in the push subscription URL, if configured
    if (env.GMAIL_PUBSUB_VERIFICATION_TOKEN) {
      const token = (req.query.token as string | undefined) ?? '';
      if (token !== env.GMAIL_PUBSUB_VERIFICATION_TOKEN) {
        logger.warn({ ip: req.ip }, 'Gmail webhook rejected: invalid verification token');
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    const pubsubMessage = req.body?.message;
    if (!pubsubMessage?.data) {
      res.status(400).json({ error: 'Invalid Pub/Sub message' });
      return;
    }

    const decoded = JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString());
    const { emailAddress, historyId } = decoded;

    if (!emailAddress || !historyId) {
      res.status(400).json({ error: 'Missing emailAddress or historyId' });
      return;
    }

    // Ack the Pub/Sub push immediately; processing happens async so we never hit the 10s deadline.
    res.status(204).end();

    handlePubSubNotification({ emailAddress, historyId }).catch((error: any) => {
      logger.error(
        { error: error.message, emailAddress, historyId },
        'Async Pub/Sub processing failed'
      );
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Webhook handler error');
    // Ack with 204 to stop Google retries for permanent errors we already logged.
    if (!res.headersSent) {
      res.status(204).end();
    }
  }
}
