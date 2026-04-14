import * as jwt from 'jsonwebtoken';

import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  device_name: string | null;
  is_active: boolean;
  last_used_at: string;
  created_at: string;
}

interface FCMMessage {
  message: {
    token: string;
    notification: {
      title: string;
      body: string;
    };
    data?: Record<string, string>;
    apns?: {
      payload: {
        aps: {
          badge?: number;
          sound?: string;
        };
      };
    };
    android?: {
      notification: {
        sound?: string;
      };
    };
  };
}

interface FCMSendResult {
  success: boolean;
  token: string;
  error?: string;
  invalidToken?: boolean;
}

// ============================================================================
// FCM AUTH
// ============================================================================

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getFCMAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5-min buffer)
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedAccessToken.token;
  }

  const serviceAccountEmail = process.env.FCM_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!serviceAccountEmail || !privateKey) {
    throw new Error('FCM credentials not configured (FCM_SERVICE_ACCOUNT_EMAIL, FCM_PRIVATE_KEY)');
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600, // 1 hour
  };

  const signedJwt = jwt.sign(jwtPayload, privateKey, { algorithm: 'RS256' });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get FCM access token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cachedAccessToken.token;
}

// ============================================================================
// SERVICE
// ============================================================================

export class PushService {
  // --------------------------------------------------------------------------
  // TOKEN MANAGEMENT
  // --------------------------------------------------------------------------

  /**
   * Register (upsert) a push token for a user.
   */
  static async registerToken(
    userId: string,
    token: string,
    platform: 'ios' | 'android' | 'web',
    deviceName?: string
  ): Promise<PushToken> {
    const supabaseAdmin = createAdminSupabase();

    // Upsert: if token already exists, update it
    const { data, error } = await supabaseAdmin
      .from('push_tokens')
      .upsert(
        {
          user_id: userId,
          token,
          platform,
          device_name: deviceName || null,
          is_active: true,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'token' }
      )
      .select()
      .single();

    if (error) {
      console.error('[PushService.registerToken] Error:', error);
      throw error;
    }

    console.log(`[PushService.registerToken] Token registered for user ${userId} (${platform})`);
    return data as PushToken;
  }

  /**
   * Deactivate a push token.
   */
  static async removeToken(token: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('push_tokens')
      .update({ is_active: false })
      .eq('token', token);

    if (error) {
      console.error('[PushService.removeToken] Error:', error);
      throw error;
    }

    console.log(`[PushService.removeToken] Token deactivated`);
  }

  /**
   * Get all active tokens for a user.
   */
  static async getActiveTokens(userId: string): Promise<PushToken[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('push_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      console.error('[PushService.getActiveTokens] Error:', error);
      throw error;
    }

    return (data || []) as PushToken[];
  }

  // --------------------------------------------------------------------------
  // SENDING
  // --------------------------------------------------------------------------

  /**
   * Send a push notification to a single user (all their active devices).
   * Returns the number of successfully sent messages.
   */
  static async sendPush(userId: string, notification: PushNotification): Promise<number> {
    const tokens = await this.getActiveTokens(userId);

    if (tokens.length === 0) {
      console.log(`[PushService.sendPush] No active tokens for user ${userId}`);
      return 0;
    }

    let successCount = 0;
    const invalidTokenIds: string[] = [];

    for (const tokenRecord of tokens) {
      const result = await this.sendToToken(tokenRecord, notification);
      if (result.success) {
        successCount++;
      } else if (result.invalidToken) {
        invalidTokenIds.push(tokenRecord.id);
      }
    }

    // Deactivate invalid tokens
    if (invalidTokenIds.length > 0) {
      await this.deactivateTokensById(invalidTokenIds);
    }

    return successCount;
  }

  /**
   * Send a push notification to multiple users.
   */
  static async sendBulkPush(
    userIds: string[],
    notification: PushNotification
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    // Process in batches of 10 to avoid overwhelming FCM
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((userId) => this.sendPush(userId, notification))
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value > 0) {
          sent++;
        } else {
          failed++;
        }
      }
    }

    return { sent, failed };
  }

  /**
   * Remove tokens not used in 90 days.
   */
  static async cleanupStaleTokens(): Promise<number> {
    const supabaseAdmin = createAdminSupabase();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const { data, error } = await supabaseAdmin
      .from('push_tokens')
      .delete()
      .lt('last_used_at', cutoffDate.toISOString())
      .select('id');

    if (error) {
      console.error('[PushService.cleanupStaleTokens] Error:', error);
      throw error;
    }

    const count = data?.length || 0;
    console.log(`[PushService.cleanupStaleTokens] Removed ${count} stale tokens`);
    return count;
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  /**
   * Send a single FCM message to a specific token.
   */
  private static async sendToToken(
    tokenRecord: PushToken,
    notification: PushNotification
  ): Promise<FCMSendResult> {
    const projectId = process.env.FCM_PROJECT_ID;
    if (!projectId) {
      console.error('[PushService.sendToToken] FCM_PROJECT_ID not configured');
      return { success: false, token: tokenRecord.token, error: 'FCM_PROJECT_ID not configured' };
    }

    try {
      const accessToken = await getFCMAccessToken();

      const message: FCMMessage = {
        message: {
          token: tokenRecord.token,
          notification: {
            title: notification.title,
            body: notification.body,
          },
          data: notification.data,
          apns: {
            payload: {
              aps: {
                badge: notification.badge,
                sound: notification.sound || 'default',
              },
            },
          },
          android: {
            notification: {
              sound: notification.sound || 'default',
            },
          },
        },
      };

      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        }
      );

      if (response.ok) {
        // Update last_used_at
        const supabaseAdmin = createAdminSupabase();
        await supabaseAdmin
          .from('push_tokens')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', tokenRecord.id);

        return { success: true, token: tokenRecord.token };
      }

      const errorData = await response.json();
      const errorCode = errorData?.error?.details?.[0]?.errorCode || errorData?.error?.code;

      // Check if token is invalid/unregistered
      const isInvalidToken =
        errorCode === 'UNREGISTERED' ||
        errorCode === 'INVALID_ARGUMENT' ||
        response.status === 404;

      if (isInvalidToken) {
        console.warn(`[PushService.sendToToken] Invalid token detected, will deactivate`);
      } else {
        console.error(`[PushService.sendToToken] FCM error:`, errorData);
      }

      return {
        success: false,
        token: tokenRecord.token,
        error: errorData?.error?.message || `HTTP ${response.status}`,
        invalidToken: isInvalidToken,
      };
    } catch (error: any) {
      console.error(`[PushService.sendToToken] Exception:`, error);
      return {
        success: false,
        token: tokenRecord.token,
        error: error.message,
      };
    }
  }

  /**
   * Deactivate tokens by their IDs.
   */
  private static async deactivateTokensById(ids: string[]): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin
      .from('push_tokens')
      .update({ is_active: false })
      .in('id', ids);

    if (error) {
      console.error('[PushService.deactivateTokensById] Error:', error);
    } else {
      console.log(`[PushService.deactivateTokensById] Deactivated ${ids.length} invalid tokens`);
    }
  }
}
