import * as jwt from 'jsonwebtoken';

import { createAdminSupabase } from '../supabase-admin';

import { QUIET_CHAT_RELEVANCE } from './push-presentation';

// ============================================================================
// TYPES
// ============================================================================

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
  /**
   * Deliver without a sound (burst follow-ups — docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §2.1):
   * `aps.sound` is omitted on both wire shapes. Pair with interruptionLevel 'passive'.
   */
  silent?: boolean;
  /**
   * Chat wire shape (set by NotificationOrchestrator for chat types only):
   * data-only on Android (no top-level notification block, HIGH priority) and
   * alert + apns-priority 10 + thread-id (= circleId, groups per circle) on iOS.
   */
  chat?: { threadId: string };
  /**
   * Android notification channel for the legacy (notification-message) shape, used by FCM when it
   * auto-displays a background push. Unset = the app's default channel (unchanged behaviour). An
   * unknown channel on an older build also falls back to the default channel.
   */
  androidChannelId?: string;
  /**
   * Replace-instead-of-stack key (the caller's dedupeKey, ≤ 64 bytes): sent as
   * the APNs `apns-collapse-id` header on both shapes and, for the legacy
   * (notification-message) shape, as the Android notification `tag`. Data-only
   * Android chat pushes have no FCM notification block, so the app gets it as
   * `data.dedupeKey` instead.
   */
  collapseId?: string;
  /**
   * APNs `thread-id` for the legacy shape (chat uses `chat.threadId`): groups
   * the notification centre per category.
   */
  threadId?: string;
  /**
   * iOS rich-notification fields (see push-presentation.ts). Additive: merged
   * into `aps` for both wire shapes; `custom` keys sit beside `aps` in the
   * APNs payload (objects allowed — unlike FCM `data`, which is strings only).
   * Android ignores all of it.
   */
  apns?: ApnsExtras;
  /**
   * chat_message "alert once" (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §2.1), applied
   * per device by forDevice(): only tokens that declared `chat_quiet` get the quiet
   * variant (`quiet`) or a burst follow-up (`burstFollowUp`); other tokens get the
   * plain push, and nothing for a burst follow-up (the pre-2026-11-02 drop rule).
   */
  chatDelivery?: { quiet: boolean; burstFollowUp: boolean };
}

export interface ApnsExtras {
  category?: string;
  mutableContent?: boolean;
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive';
  relevanceScore?: number;
  /** `aps.summary-arg`: "N more notifications from <summaryArg>" on a collapsed stack. */
  summaryArg?: string;
  custom?: Record<string, unknown>;
}

type ApsDictionary = {
  alert?: { title: string; body: string };
  badge?: number;
  sound?: string;
  'thread-id'?: string;
  category?: string;
  'mutable-content'?: 1;
  'interruption-level'?: 'passive' | 'active' | 'time-sensitive';
  'relevance-score'?: number;
  'summary-arg'?: string;
};

/** The `aps` additions for `extras` (absent fields stay absent). Pure; unit-tested. */
export function apsExtras(extras: ApnsExtras | undefined): Partial<ApsDictionary> {
  if (!extras) return {};
  const out: Partial<ApsDictionary> = {};
  if (extras.category) out.category = extras.category;
  if (extras.mutableContent) out['mutable-content'] = 1;
  if (extras.interruptionLevel) out['interruption-level'] = extras.interruptionLevel;
  if (typeof extras.relevanceScore === 'number' && Number.isFinite(extras.relevanceScore)) {
    out['relevance-score'] = Math.min(1, Math.max(0, extras.relevanceScore));
  }
  if (extras.summaryArg) out['summary-arg'] = extras.summaryArg;
  return out;
}

/**
 * Optional out-parameter for sendPush: what the user's devices looked like, so
 * the caller can tell "no active token" from "every send failed" (Push Sent
 * analytics, docs/PUSH_NOTIFICATIONS.md §7). Filled once the tokens are read.
 */
export interface PushSendReport {
  /** Active push tokens found for the user (-1 = not read). */
  activeTokens: number;
  /** Distinct platforms of those tokens. */
  platforms: Array<PushToken['platform']>;
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
  /** X-Client-Features the app sent when it registered this token (migration 123; absent before it). */
  client_features?: string[] | null;
}

/**
 * The device's app resets/updates the icon badge itself (chat read sync), so a
 * push may set `aps.badge`. Shipped builds never clear it — they get no badge.
 */
export const CHAT_BADGE_FEATURE = 'chat_badge';
/**
 * The device's app renders quiet chat follow-ups (passive / setOnlyAlertOnce),
 * so it gets every member message: burst follow-ups are delivered quietly
 * instead of dropped. Without it a device keeps the old burst drop rule.
 */
export const CHAT_QUIET_FEATURE = 'chat_quiet';

/** X-Client-Features → normalized list (lowercase snake tokens, ≤ 32). Pure. */
export function parseClientFeatures(header: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const raw of (header ?? '').split(',')) {
    const f = raw.trim().toLowerCase();
    if (/^[a-z][a-z0-9_]{0,39}$/.test(f)) out.add(f);
    if (out.size >= 32) break;
  }
  return [...out];
}

/** The quiet variant of a chat push: passive, no sound, data.quiet. Pure. */
export function quietVariant(n: PushNotification): PushNotification {
  return {
    ...n,
    silent: true,
    data: { ...(n.data ?? {}), quiet: 'true' },
    apns: { ...(n.apns ?? {}), interruptionLevel: 'passive', relevanceScore: QUIET_CHAT_RELEVANCE },
  };
}

/**
 * The notification as this device may receive it, or null (skip this device):
 *  - chat "alert once": chat_quiet devices get every member message, quiet inside
 *    the circle's window; other devices get the plain push and no burst follow-ups;
 *  - no badge unless the device declared chat_badge.
 * Pure.
 */
export function forDevice(token: Pick<PushToken, 'client_features'>, notification: PushNotification): PushNotification | null {
  const features = token.client_features ?? [];
  let out = notification;
  if (out.chatDelivery) {
    const { chatDelivery, ...plain } = out;
    const capable = features.includes(CHAT_QUIET_FEATURE);
    if (!capable && chatDelivery.burstFollowUp) return null;
    out = capable && chatDelivery.quiet ? quietVariant(plain) : plain;
  }
  if (out.badge !== undefined && !features.includes(CHAT_BADGE_FEATURE)) {
    const { badge: _badge, ...rest } = out;
    out = rest;
  }
  return out;
}

interface FCMMessage {
  message: {
    token: string;
    // Omitted for chat messages (data-only on Android; iOS alert lives in apns).
    notification?: {
      title: string;
      body: string;
    };
    data?: Record<string, string>;
    apns?: {
      headers?: Record<string, string>;
      payload: {
        aps: ApsDictionary;
        [custom: string]: unknown;
      };
    };
    android?: {
      priority?: 'NORMAL' | 'HIGH';
      notification?: {
        sound?: string;
        channel_id?: string;
        tag?: string;
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
// WIRE SHAPE
// ============================================================================

/**
 * Build the FCM v1 message for one token. Pure; unit-tested.
 *
 * Chat: data-only for Android (the app renders/suppresses its own
 * notification), while iOS still gets an alert via apns — required for
 * apns-priority 10 — grouped per circle by thread-id.
 * Everything else: the legacy notification + data shape.
 * Both carry the optional iOS rich-notification extras (category,
 * mutable-content, interruption-level, relevance-score, custom keys).
 */
export function buildFCMMessage(token: string, notification: PushNotification): FCMMessage {
  const extras = apsExtras(notification.apns);
  const custom = notification.apns?.custom ?? {};
  if (notification.chat) {
    return {
      message: {
        token,
        data: notification.data,
        android: {
          priority: 'HIGH',
        },
        apns: {
          headers: {
            'apns-priority': '10',
            ...(notification.collapseId ? { 'apns-collapse-id': notification.collapseId } : {}),
          },
          payload: {
            ...custom,
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              ...(notification.silent ? {} : { sound: notification.sound || 'default' }),
              ...(typeof notification.badge === 'number' ? { badge: notification.badge } : {}),
              ...(notification.chat.threadId ? { 'thread-id': notification.chat.threadId } : {}),
              ...extras,
            },
          },
        },
      },
    };
  }
  return {
    message: {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      apns: {
        ...(notification.collapseId
          ? { headers: { 'apns-collapse-id': notification.collapseId } }
          : {}),
        payload: {
          ...custom,
          aps: {
            badge: notification.badge,
            ...(notification.silent ? {} : { sound: notification.sound || 'default' }),
            ...(notification.threadId ? { 'thread-id': notification.threadId } : {}),
            ...extras,
          },
        },
      },
      android: {
        notification: {
          sound: notification.sound || 'default',
          ...(notification.androidChannelId ? { channel_id: notification.androidChannelId } : {}),
          ...(notification.collapseId ? { tag: notification.collapseId } : {}),
        },
      },
    },
  };
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
    deviceName?: string,
    clientFeatures: string[] = []
  ): Promise<PushToken> {
    const supabaseAdmin = createAdminSupabase();

    const row = {
      user_id: userId,
      token,
      platform,
      device_name: deviceName || null,
      is_active: true,
      last_used_at: new Date().toISOString(),
    };
    // Upsert: if token already exists, update it. client_features is replaced on
    // every registration (an app downgrade drops its capabilities).
    let { data, error } = await supabaseAdmin
      .from('push_tokens')
      .upsert({ ...row, client_features: clientFeatures }, { onConflict: 'token' })
      .select()
      .single();
    // Before migration 123 the column doesn't exist: register without it (no badge for this device).
    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      ({ data, error } = await supabaseAdmin.from('push_tokens').upsert(row, { onConflict: 'token' }).select().single());
    }

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
  static async sendPush(userId: string, notification: PushNotification, report?: PushSendReport): Promise<number> {
    const tokens = await this.getActiveTokens(userId);
    if (report) {
      report.activeTokens = tokens.length;
      report.platforms = [...new Set(tokens.map((t) => t.platform))];
    }

    if (tokens.length === 0) {
      console.log(`[PushService.sendPush] No active tokens for user ${userId}`);
      return 0;
    }

    let successCount = 0;
    const invalidTokenIds: string[] = [];

    for (const tokenRecord of tokens) {
      const shaped = forDevice(tokenRecord, notification);
      if (!shaped) continue; // e.g. a burst follow-up for a device without chat_quiet
      const result = await this.sendToToken(tokenRecord, shaped);
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

      const message = buildFCMMessage(tokenRecord.token, notification);

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
