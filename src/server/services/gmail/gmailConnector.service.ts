import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { encrypt, decrypt } from '../encryption.service';
import type { GmailFilterRule } from '../../../shared/emailTypes';

interface OAuthTokenData {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface ConnectorPublic {
  id: string;
  email: string;
  status: string;
  lastSyncAt: Date | null;
  filterRules: unknown;
  labelsConfig: unknown;
  createdAt: Date;
}

const GMAIL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
];

export class GmailConnectorService {
  constructor(private readonly prisma: PrismaClient) {}

  isOAuthConfigured(): boolean {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
  }

  generateAuthUrl(orgId: string): string {
    if (!this.isOAuthConfigured()) {
      throw new Error(
        'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env.'
      );
    }

    const clientId = env.GOOGLE_CLIENT_ID!;
    const redirectUri = env.GOOGLE_REDIRECT_URI!;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: orgId,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokenData> {
    const oauth2Client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to obtain both access and refresh tokens from Google');
    }

    let email = '';
    
    if (tokens.id_token) {
      // Get email from ID Token
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.GOOGLE_CLIENT_ID,
      });
      email = ticket.getPayload()?.email || '';
    } else {
      // Fallback: Get email from UserInfo API
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      email = userInfo.data.email || '';
    }

    if (!email) {
      throw new Error('Could not verify email from Google');
    }

    return {
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
    };
  }

  async storeConnector(orgId: string, tokenData: OAuthTokenData) {
    const encryptedTokens = encrypt(
      JSON.stringify({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt.toISOString(),
      })
    );

    const defaultLabels = {
      queued: 'ClaimsIntell/Queued',
      processing: 'ClaimsIntell/Processing',
      processed: 'ClaimsIntell/Processed',
      needsReview: 'ClaimsIntell/NeedsReview',
      querySent: 'ClaimsIntell/QuerySent',
      queryResponded: 'ClaimsIntell/QueryResponded',
      failed: 'ClaimsIntell/Failed',
      duplicate: 'ClaimsIntell/Duplicate',
      notAClaim: 'ClaimsIntell/NotAClaim',
    };

    const connector = await this.prisma.gmailConnector.create({
      data: {
        orgId,
        email: tokenData.email,
        oauthTokens: encryptedTokens,
        status: 'CONNECTED',
        labelsConfig: defaultLabels,
        filterRules: [],
        lastSyncAt: new Date(),
      },
    });

    return {
      id: connector.id,
      email: connector.email,
      status: connector.status,
      labelsConfig: connector.labelsConfig,
      createdAt: connector.createdAt,
    };
  }

  async getConnector(orgId: string, email: string): Promise<ConnectorPublic | null> {
    const connector = await this.prisma.gmailConnector.findFirst({
      where: { orgId, email },
      select: {
        id: true,
        email: true,
        status: true,
        lastSyncAt: true,
        filterRules: true,
        labelsConfig: true,
        createdAt: true,
      },
    });

    return connector;
  }

  async getConnectorById(connectorId: string): Promise<ConnectorPublic | null> {
    const connector = await this.prisma.gmailConnector.findUnique({
      where: { id: connectorId },
      select: {
        id: true,
        email: true,
        status: true,
        lastSyncAt: true,
        filterRules: true,
        labelsConfig: true,
        createdAt: true,
      },
    });

    return connector;
  }

  async listConnectors(orgId: string): Promise<ConnectorPublic[]> {
    const connectors = await this.prisma.gmailConnector.findMany({
      where: { orgId },
      select: {
        id: true,
        email: true,
        status: true,
        lastSyncAt: true,
        filterRules: true,
        labelsConfig: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return connectors;
  }

  async disconnectConnector(connectorId: string): Promise<void> {
    await this.prisma.gmailConnector.delete({
      where: { id: connectorId },
    });
  }

  async updateFilterRules(connectorId: string, rules: GmailFilterRule[]) {
    const updated = await this.prisma.gmailConnector.update({
      where: { id: connectorId },
      data: { filterRules: rules as any },
      select: {
        id: true,
        email: true,
        status: true,
        lastSyncAt: true,
        filterRules: true,
        labelsConfig: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async updateStatus(connectorId: string, status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'AUTH_EXPIRED') {
    await this.prisma.gmailConnector.update({
      where: { id: connectorId },
      data: { status },
    });
  }

  async updateLastSync(connectorId: string, historyId?: string) {
    await this.prisma.gmailConnector.update({
      where: { id: connectorId },
      data: {
        lastSyncAt: new Date(),
        ...(historyId ? { historyId } : {}),
      },
    });
  }

  async getDecryptedTokens(connectorId: string): Promise<StoredTokens> {
    const connector = await this.prisma.gmailConnector.findUnique({
      where: { id: connectorId },
      select: { oauthTokens: true },
    });

    if (!connector) {
      throw new Error(`Connector not found: ${connectorId}`);
    }

    return JSON.parse(decrypt(connector.oauthTokens));
  }

  async getAccessToken(connectorId: string): Promise<string> {
    const tokens = await this.getDecryptedTokens(connectorId);
    
    // Check if token is expired or will expire in the next 5 minutes
    const expiresAt = new Date(tokens.expiresAt).getTime();
    const now = Date.now();
    
    if (expiresAt > now + 5 * 60 * 1000) {
      return tokens.accessToken;
    }

    // Token is expired or expiring soon, refresh it
    const oauth2Client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: tokens.refreshToken,
    });

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      const updatedTokens: StoredTokens = {
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token || tokens.refreshToken,
        expiresAt: new Date(credentials.expiry_date || Date.now() + 3600000).toISOString(),
      };

      const encryptedTokens = encrypt(JSON.stringify(updatedTokens));
      await this.prisma.gmailConnector.update({
        where: { id: connectorId },
        data: { 
          oauthTokens: encryptedTokens,
          status: 'CONNECTED',
        },
      });

      return updatedTokens.accessToken;
    } catch (error: any) {
      console.error(`Failed to refresh Gmail token for connector ${connectorId}:`, error.message);
      
      // If the refresh token is invalid/revoked, mark the connector
      await this.prisma.gmailConnector.update({
        where: { id: connectorId },
        data: { status: 'AUTH_EXPIRED' },
      });
      
      throw new Error(`Gmail authentication expired: ${error.message}`);
    }
  }

  async refreshOAuthToken(connectorId: string, newAccessToken: string, expiresAt: Date): Promise<void> {
    const currentTokens = await this.getDecryptedTokens(connectorId);

    const updatedTokens = {
      ...currentTokens,
      accessToken: newAccessToken,
      expiresAt: expiresAt.toISOString(),
    };

    const encryptedTokens = encrypt(JSON.stringify(updatedTokens));

    await this.prisma.gmailConnector.update({
      where: { id: connectorId },
      data: {
        oauthTokens: encryptedTokens,
        status: 'CONNECTED',
      },
    });
  }

  async getGmailClient(connectorId: string) {
    const tokens = await this.getDecryptedTokens(connectorId);
    const oauth2Client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: new Date(tokens.expiresAt).getTime(),
    });

    // Handle token refresh automatically
    oauth2Client.on('tokens', (newTokens) => {
      if (newTokens.access_token) {
        this.refreshOAuthToken(
          connectorId,
          newTokens.access_token,
          new Date(newTokens.expiry_date || Date.now() + 3600000)
        ).catch((err) => console.error('Failed to update refreshed tokens:', err));
      }
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  async getAttachmentData(connectorId: string, messageId: string, attachmentId: string): Promise<Buffer> {
    const gmail = await this.getGmailClient(connectorId);
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });

    const data = response.data.data;
    if (!data) {
      throw new Error('No data found in Gmail attachment');
    }

    return Buffer.from(data, 'base64');
  }
}
