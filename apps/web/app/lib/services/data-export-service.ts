import { createRateLimiter } from '../middleware/rate-limit';
import { createAdminSupabase } from '../supabase-admin';

import { isUserOwnedStoragePath } from './account-deletion-service';

/**
 * DataExportService: everything FitCircle stores about one user, as JSON.
 *
 * UK/EU GDPR Art. 15 (access) and Art. 20 (portability), PIPEDA access, PDPA
 * s.21. Free for every signed-in account (no Pro gate). Shared by
 * GET /api/privacy/export (web, cookie auth) and GET /api/mobile/privacy/export
 * (mobile, bearer auth).
 *
 * The table list (EXPORT_TABLES) was built from every public table with a
 * foreign key to profiles(id) / auth.users in production (2026-11-06), plus the
 * deletion service's lists. Rules:
 *  - Only rows that belong to the user: filtered on the user's own column.
 *    Chat: only messages the user authored. Encouragements: only the ones sent.
 *  - Other people's contact details are never exported (invitee emails, names,
 *    contact hashes, device hashes): those tables use an explicit column list.
 *  - Credentials are never exported: no push token values, no Apple refresh
 *    token, no session token hashes.
 *  - Photos are short-lived signed links (SIGNED_URL_TTL_SECONDS), never bytes,
 *    and only for objects inside the user's own storage prefix.
 *  - Every table read is fail-soft: an error is recorded in manifest.errors and
 *    the table exports as [].
 *  - Each table is capped at ROW_CAP rows (manifest.truncated lists the ones
 *    that hit it).
 *
 * The legacy top-level keys of export v1 (export_metadata, account, profile,
 * health_data, challenges, notifications, privacy) are kept unchanged. New
 * content is additive: exportVersion, generatedAt, signedUrlExpiresAt, tables,
 * manifest, data.
 */

type AdminClient = ReturnType<typeof createAdminSupabase>;
type Row = Record<string, any>;

interface DbError {
  code?: string;
  message?: string;
}

export const EXPORT_VERSION = 2;
export const ROW_CAP = 50_000;
/** PostgREST returns at most 1000 rows per request (db max-rows). */
export const PAGE_SIZE = 1000;
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
const TABLE_CONCURRENCY = 8;
const IN_CHUNK = 200;
const SIGN_CHUNK = 100;

/** Per user, per server instance (in-memory): 5 exports an hour. */
export const dataExportRateLimiter = createRateLimiter({
  interval: 60 * 60 * 1000,
  uniqueTokenPerInterval: 5000,
  maxRequests: 5,
});

// ============================================================================
// TABLE LIST
// ============================================================================

export interface ExportTableSpec {
  /** Key under `data` and in the manifest. */
  name: string;
  table: string;
  /** Column holding the user id. */
  column: string;
  /** Explicit columns. Default '*'. Used to leave out credentials and other people's data. */
  select?: string;
  /** Stable order for paging. Default 'id'. */
  order?: string;
  /** Missing table is normal (e.g. not migrated yet): export [] without an error. */
  optional?: boolean;
}

export interface ExportChildSpec {
  name: string;
  table: string;
  /** Column referencing the parent's id. */
  column: string;
  /** Name of the parent spec whose `id`s are matched. */
  parent: string;
  select?: string;
  order?: string;
}

const t = (
  name: string,
  column = 'user_id',
  opts: Omit<ExportTableSpec, 'name' | 'table' | 'column'> & { table?: string } = {}
): ExportTableSpec => ({ name, table: opts.table ?? name, column, ...opts });

/** Every table exported, top to bottom. Exported for tests and documentation. */
export const EXPORT_TABLES: readonly ExportTableSpec[] = [
  // --- Account and settings -------------------------------------------------
  t('profiles', 'id'),
  t('privacy_settings'),
  t('notification_preferences'),
  t('dietary_preferences', 'user_id', { order: 'user_id' }),
  t('user_consent', 'user_id', { order: 'consent_timestamp' }),
  // Migration 130 (server-side consent records). Missing until it is applied.
  t('user_consents', 'user_id', { order: 'granted_at', optional: true }),
  t('onboarding_progress'),
  t('onboarding_responses'),
  t('user_goals'),
  t('daily_goals'),
  t('weekly_goals'),
  t('goal_completion_history'),
  t('user_attribution', 'user_id', { order: 'user_id' }),
  t('experiment_assignments', 'user_id', { order: 'experiment_key' }),
  t('complimentary_grants'),
  t('health_nutrition_sync', 'user_id', {
    select: 'platform, enabled, last_sync_at, created_at, updated_at',
    order: 'platform',
  }),
  // Credentials: existence and dates only, never the token values.
  t('push_tokens', 'user_id', {
    select: 'id, platform, device_name, is_active, last_used_at, created_at, client_features',
  }),
  t('apple_auth_tokens', 'user_id', { select: 'created_at, updated_at', order: 'created_at' }),
  t('token_blacklist', 'user_id', { select: 'id, blacklisted_at, expires_at, reason, created_at' }),

  // --- Health and logging ---------------------------------------------------
  t('daily_tracking', 'user_id', { order: 'tracking_date' }),
  t('check_ins'),
  t('body_composition_logs'),
  t('body_comp_import_tombstones'),
  t('body_comp_parse_log'),
  t('food_log_entries'),
  t('food_log_images'),
  t('food_log_audit'),
  t('food_log_shares', 'owner_id'),
  t('custom_foods', 'owner_id', {
    table: 'foods',
    // search_vector (tsvector) left out.
    select:
      'id, source, source_id, name, brand, barcode, serving_size_g, serving_unit, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, sugar_per_100g, sodium_per_100g, locale, recipe_ingredients, recipe_servings, image_url, data_type, category, created_at, updated_at',
  }),
  t('nutrition_parse_log'),
  t('nutrition_training_samples'),
  t('plate_scores'),
  t('beverage_logs'),
  t('beverage_log_images'),
  t('exercise_logs'),
  t('custom_exercises', 'created_by', { table: 'exercises' }),
  t('progress_entries'),

  // --- Streaks, goals, achievements ----------------------------------------
  t('engagement_streaks'),
  t('engagement_activities'),
  t('metric_streaks'),
  t('streak_claims'),
  t('streak_shields'),
  t('streak_recoveries'),
  t('achievements'),
  t('user_achievements'),

  // --- Fitzy (AI coach) -----------------------------------------------------
  t('fitzy_conversations'),
  t('fitzy_messages'),
  t('fitzy_memory', 'user_id', { order: 'user_id' }),
  t('fitzy_plans'),
  t('fitzy_daily', 'user_id', { order: 'date' }),
  t('fitzy_message_log'),
  t('fitzy_push_deliveries', 'user_id', { order: 'delivery_key' }),

  // --- Circles, chat and challenges ----------------------------------------
  t('circles_created', 'creator_id', { table: 'fitcircles' }),
  t('fitcircle_members'),
  // Only messages the user wrote; other members' messages are theirs.
  t('circle_messages', 'sender_id', {
    select:
      'id, fitcircle_id, kind, body, photo_url, client_id, priority, created_at, updated_at, edited_at, deleted_at',
  }),
  t('circle_message_reactions', 'user_id', { order: 'created_at' }),
  t('circle_message_reports', 'reporter_id'),
  t('circle_chat_state', 'user_id', { order: 'fitcircle_id' }),
  t('circle_food_privacy', 'user_id', { order: 'fitcircle_id' }),
  t('circle_member_blocks', 'blocker_id'),
  t('circle_check_ins'),
  t('circle_encouragements_sent', 'from_user_id', { table: 'circle_encouragements' }),
  // The invitee's email is someone else's personal data.
  t('circle_invites', 'inviter_id', {
    select: 'id, circle_id, invite_code, status, created_at, accepted_at, expires_at',
  }),
  t('circle_quest_progress'),
  t('circle_streak_saves', 'saver_user_id'),
  t('challenges_created', 'creator_id', { table: 'challenges' }),
  t('challenge_participants'),
  t('challenge_logs'),
  t('challenge_invites_sent', 'inviter_id', { table: 'challenge_invites' }),
  t('challenge_invites_received', 'invitee_id', { table: 'challenge_invites' }),
  t('challenge_invitations_sent', 'invited_by', {
    table: 'challenge_invitations',
    select: 'id, challenge_id, status, invited_at, responded_at, expires_at',
  }),
  t('daily_challenge_participants'),
  t('fitcircle_data_submissions'),
  t('fitcircle_leaderboard_entries'),
  t('daily_high_five_limits'),
  t('team_members'),
  t('comments'),
  t('reactions'),
  t('log_reactions', 'user_id', { order: 'created_at' }),
  t('group_meals', 'creator_id'),
  t('group_meal_tags', 'tagged_user_id'),
  t('share_cards'),

  // --- Notifications --------------------------------------------------------
  t('notifications'),
  t('notification_log'),
  t('campaign_participants', 'user_id', { order: 'campaign_id' }),
  t('campaign_deliveries'),
  t('promo_user_state', 'user_id', { order: 'promo_key' }),
  t('home_feed_decisions'),
  t('home_feed_events'),

  // --- Referrals ------------------------------------------------------------
  t('referral_codes', 'user_id', { order: 'code' }),
  t('referral_devices', 'user_id', { order: 'device_hash' }),
  t('referral_rewards'),
  // As referrer: the invitee's device hash is theirs.
  t('referrals_sent', 'inviter_id', {
    table: 'referrals',
    select:
      'id, invitee_id, code, circle_id, source, status, status_reason, attributed_at, qualified_at, created_at, nudge_count, last_nudged_at, inviter_notified_at, progress_days, progress_notified_days',
  }),
  t('referrals_received', 'invitee_id', { table: 'referrals' }),
  // Invites the user sent: no invitee email, name, display or contact hash.
  t('referral_invites', 'inviter_id', {
    select: 'id, channel, circle_id, status, referral_id, nudge_count, last_nudged_at, sent_at, joined_at, created_at',
  }),

  // --- Purchases ------------------------------------------------------------
  t('subscription_events'),
  t('payments'),
];

/** Rows reached through a parent the user owns (no user column of their own). */
export const EXPORT_CHILD_TABLES: readonly ExportChildSpec[] = [
  { name: 'workout_exercises', table: 'workout_exercises', column: 'exercise_log_id', parent: 'exercise_logs' },
  { name: 'exercise_sets', table: 'exercise_sets', column: 'workout_exercise_id', parent: 'workout_exercises' },
];

/** Key names of every table in the export (for documentation and tests). */
export const EXPORT_TABLE_NAMES: readonly string[] = [
  ...EXPORT_TABLES.map((s) => s.name),
  ...EXPORT_CHILD_TABLES.map((s) => s.name),
];

// ============================================================================
// HELPERS
// ============================================================================

const STORAGE_URL_PATTERN = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;
const NUTRITION_TRAINING_BUCKET = 'nutrition-training';

function isMissingRelation(error: DbError | null | undefined): boolean {
  if (!error) return false;
  const text = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    (text.includes('relation') && text.includes('does not exist')) ||
    text.includes('could not find the table')
  );
}

function describeError(error: unknown): { code: string | null; message: string } {
  if (error && typeof error === 'object') {
    const e = error as DbError;
    return { code: e.code ?? null, message: e.message ?? 'unknown error' };
  }
  return { code: null, message: error instanceof Error ? error.message : 'unknown error' };
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A URL to an object in this project's storage, as `{bucket, path}`. */
function parseStorageUrl(url: unknown): { bucket: string; path: string } | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (typeof url !== 'string' || !base || !url.startsWith(`${base}/`)) return null;
  const match = STORAGE_URL_PATTERN.exec(url);
  if (!match) return null;
  try {
    return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

// ============================================================================
// SERVICE
// ============================================================================

export interface ExportAccount {
  id: string;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
}

export interface ExportManifest {
  rowCap: number;
  truncated: string[];
  errors: Array<{ table: string; code: string | null; message: string }>;
  signedUrls: number;
}

export interface DataExport {
  exportVersion: number;
  generatedAt: string;
  signedUrlExpiresAt: string;
  tables: Record<string, number>;
  manifest: ExportManifest;
  export_metadata: Record<string, unknown>;
  account: Record<string, unknown>;
  profile: Row | null;
  health_data: { daily_tracking: Row[]; check_ins: Row[]; record_count: number };
  challenges: { participations: Row[]; count: number };
  notifications: Row[];
  privacy: { consent_history: Row[]; current_settings: Row | null };
  data: Record<string, Row[]>;
}

interface TableResult {
  rows: Row[];
  truncated: boolean;
  error: { code: string | null; message: string } | null;
}

export class DataExportService {
  static async buildExport(
    account: ExportAccount,
    opts: { db?: AdminClient; now?: Date; platform?: 'web' | 'mobile' } = {}
  ): Promise<DataExport> {
    const db = opts.db ?? createAdminSupabase();
    const now = opts.now ?? new Date();
    const userId = account.id;
    const manifest: ExportManifest = { rowCap: ROW_CAP, truncated: [], errors: [], signedUrls: 0 };
    const data: Record<string, Row[]> = {};

    const record = (name: string, result: TableResult) => {
      data[name] = result.rows;
      if (result.truncated) manifest.truncated.push(name);
      if (result.error) manifest.errors.push({ table: name, ...result.error });
    };

    const results = await mapPool(EXPORT_TABLES, TABLE_CONCURRENCY, (spec) =>
      this.readTable(db, spec.table, spec.select ?? '*', spec.order ?? 'id', (q) => q.eq(spec.column, userId), spec.optional)
    );
    EXPORT_TABLES.forEach((spec, i) => record(spec.name, results[i]));

    // Children in dependency order (workout_exercises before exercise_sets).
    for (const child of EXPORT_CHILD_TABLES) {
      const parentIds = (data[child.parent] ?? []).map((r) => r.id).filter((id) => id != null);
      record(child.name, await this.readChildren(db, child, parentIds));
    }

    manifest.signedUrls = await this.attachSignedUrls(db, userId, data);

    const tables: Record<string, number> = {};
    for (const name of EXPORT_TABLE_NAMES) tables[name] = data[name]?.length ?? 0;

    const profile = data.profiles?.[0] ?? null;
    const privacySettings = data.privacy_settings?.[0] ?? null;
    const dailyTracking = data.daily_tracking ?? [];
    const checkIns = data.check_ins ?? [];
    const memberships = data.fitcircle_members ?? [];
    const generatedAt = now.toISOString();

    return {
      exportVersion: EXPORT_VERSION,
      generatedAt,
      signedUrlExpiresAt: new Date(now.getTime() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      tables,
      manifest,
      // ---- Export v1 keys (unchanged) ----
      export_metadata: {
        export_date: generatedAt,
        export_format: 'JSON',
        gdpr_article: 'Article 15 (Right to Access) & Article 20 (Right to Data Portability)',
        user_id: userId,
      },
      account: {
        user_id: userId,
        email: account.email ?? profile?.email ?? null,
        created_at: account.created_at ?? profile?.created_at ?? null,
        last_sign_in_at: account.last_sign_in_at ?? profile?.last_active_at ?? null,
      },
      profile,
      health_data: {
        daily_tracking: dailyTracking,
        check_ins: checkIns,
        record_count: dailyTracking.length + checkIns.length,
      },
      challenges: { participations: memberships, count: memberships.length },
      notifications: data.notifications ?? [],
      privacy: {
        consent_history: data.user_consent ?? [],
        current_settings: privacySettings,
      },
      // ---- Export v2: every table ----
      data,
    };
  }

  /** Audit trail of the export (legacy user_consent row). Never throws. */
  static async logExport(
    userId: string,
    meta: { ipAddress?: string | null; platform?: 'web' | 'mobile' },
    db: AdminClient = createAdminSupabase()
  ): Promise<void> {
    try {
      const { error } = await db.from('user_consent').insert({
        user_id: userId,
        consent_type: 'data_deletion', // Reused type for logging the export (v1 behaviour).
        consent_given: true,
        consent_version: 'data-export',
        consent_text: 'User requested data export under GDPR Article 15',
        consent_method: 'api',
        metadata: {
          export_timestamp: new Date().toISOString(),
          ip_address: meta.ipAddress || 'unknown',
          ...(meta.platform === 'mobile' ? { platform: 'mobile' } : {}),
          export_version: EXPORT_VERSION,
        },
      });
      if (error) console.warn(`[DataExportService] export not logged: ${error.message ?? 'unknown error'}`);
    } catch (err) {
      console.warn('[DataExportService] export not logged:', err instanceof Error ? err.message : 'unknown error');
    }
  }

  // ==========================================================================
  // READS
  // ==========================================================================

  /** All matching rows, paged, capped at ROW_CAP. Never throws. */
  private static async readTable(
    db: AdminClient,
    table: string,
    select: string,
    order: string,
    filter: (q: any) => any,
    optional = false
  ): Promise<TableResult> {
    const rows: Row[] = [];
    let orderBy: string | null = order;
    try {
      for (let from = 0; from < ROW_CAP; from += PAGE_SIZE) {
        const to = Math.min(from + PAGE_SIZE, ROW_CAP) - 1;
        let page = await this.readPage(db, table, select, orderBy, filter, from, to);
        // The order column is only there to make paging stable; if it does not
        // exist on this table, read without it rather than lose the table.
        if (page.error && orderBy && (page.error.code === '42703' || page.error.code === 'PGRST204') &&
            (page.error.message ?? '').includes(orderBy)) {
          orderBy = null;
          page = await this.readPage(db, table, select, orderBy, filter, from, to);
        }
        if (page.error) {
          if (optional && isMissingRelation(page.error)) return { rows: [], truncated: false, error: null };
          return { rows, truncated: false, error: describeError(page.error) };
        }
        const got = page.data ?? [];
        rows.push(...got);
        if (got.length < to - from + 1) return { rows, truncated: false, error: null };
      }
      // Reached the cap: is there anything beyond it?
      const probe = await this.readPage(db, table, select, orderBy, filter, ROW_CAP, ROW_CAP);
      return { rows, truncated: !probe.error && (probe.data?.length ?? 0) > 0, error: null };
    } catch (err) {
      return { rows, truncated: false, error: describeError(err) };
    }
  }

  private static async readPage(
    db: AdminClient,
    table: string,
    select: string,
    order: string | null,
    filter: (q: any) => any,
    from: number,
    to: number
  ): Promise<{ data: Row[] | null; error: DbError | null }> {
    let query: any = filter(db.from(table).select(select));
    if (order) query = query.order(order, { ascending: true });
    const { data, error } = await query.range(from, to);
    return { data: (data as Row[] | null) ?? null, error: (error as DbError | null) ?? null };
  }

  private static async readChildren(db: AdminClient, spec: ExportChildSpec, parentIds: unknown[]): Promise<TableResult> {
    const rows: Row[] = [];
    let truncated = false;
    for (let i = 0; i < parentIds.length; i += IN_CHUNK) {
      const chunk = parentIds.slice(i, i + IN_CHUNK);
      const result = await this.readTable(db, spec.table, spec.select ?? '*', spec.order ?? 'id', (q) =>
        q.in(spec.column, chunk)
      );
      rows.push(...result.rows);
      if (result.error) return { rows, truncated, error: result.error };
      if (result.truncated) truncated = true;
      if (rows.length >= ROW_CAP) return { rows: rows.slice(0, ROW_CAP), truncated: true, error: null };
    }
    return { rows, truncated, error: null };
  }

  // ==========================================================================
  // PHOTOS
  // ==========================================================================

  /**
   * Adds signed links (SIGNED_URL_TTL_SECONDS) next to every photo reference
   * in the user's rows. Only objects inside the user's own storage prefix are
   * signed. Never throws; returns how many links were produced.
   */
  private static async attachSignedUrls(db: AdminClient, userId: string, data: Record<string, Row[]>): Promise<number> {
    // bucket -> path -> list of setters
    const wanted = new Map<string, Map<string, Array<(url: string) => void>>>();
    const want = (bucket: unknown, path: unknown, set: (url: string) => void) => {
      if (typeof bucket !== 'string' || typeof path !== 'string') return;
      if (!isUserOwnedStoragePath(bucket, path, userId)) return;
      if (!wanted.has(bucket)) wanted.set(bucket, new Map());
      const paths = wanted.get(bucket)!;
      if (!paths.has(path)) paths.set(path, []);
      paths.get(path)!.push(set);
    };
    const wantUrl = (url: unknown, set: (signed: string) => void) => {
      const ref = parseStorageUrl(url);
      if (ref) want(ref.bucket, ref.path, set);
    };
    const wantUrlArray = (row: Row, column: string, target: string) => {
      const urls = row[column];
      if (!Array.isArray(urls) || urls.length === 0) return;
      const signed: Array<string | null> = urls.map(() => null);
      row[target] = signed;
      urls.forEach((url, i) => wantUrl(url, (s) => (signed[i] = s)));
    };

    for (const table of ['food_log_images', 'beverage_log_images']) {
      for (const row of data[table] ?? []) {
        row.signed_url = null;
        row.thumbnail_signed_url = null;
        want(row.storage_bucket, row.storage_path, (s) => (row.signed_url = s));
        want(row.storage_bucket, row.thumbnail_path, (s) => (row.thumbnail_signed_url = s));
      }
    }
    for (const row of data.nutrition_training_samples ?? []) {
      if (row.image_path) {
        row.image_signed_url = null;
        want(NUTRITION_TRAINING_BUCKET, row.image_path, (s) => (row.image_signed_url = s));
      }
    }
    for (const table of ['check_ins', 'body_composition_logs']) {
      for (const row of data[table] ?? []) wantUrlArray(row, 'photo_urls', 'photo_signed_urls');
    }
    for (const table of ['circle_messages', 'group_meals']) {
      for (const row of data[table] ?? []) {
        if (row.photo_url) wantUrl(row.photo_url, (s) => (row.photo_signed_url = s));
      }
    }
    for (const row of data.profiles ?? []) {
      if (row.avatar_url) wantUrl(row.avatar_url, (s) => (row.avatar_signed_url = s));
    }

    let produced = 0;
    for (const [bucket, paths] of wanted) {
      const all = Array.from(paths.keys());
      for (let i = 0; i < all.length; i += SIGN_CHUNK) {
        const chunk = all.slice(i, i + SIGN_CHUNK);
        try {
          const { data: signed, error } = await db.storage
            .from(bucket)
            .createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS);
          if (error) {
            console.warn(`[DataExportService] signing failed in ${bucket}: ${error.message}`);
            continue;
          }
          for (const item of signed ?? []) {
            if (!item?.path || !item.signedUrl || item.error) continue;
            for (const set of paths.get(item.path) ?? []) {
              set(item.signedUrl);
              produced++;
            }
          }
        } catch (err) {
          console.warn(
            `[DataExportService] signing failed in ${bucket}:`,
            err instanceof Error ? err.message : 'unknown error'
          );
        }
      }
    }
    return produced;
  }
}
