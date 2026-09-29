import { createAdminSupabase } from '../supabase-admin';

import { AppleTokenService } from './apple-token-service';
import { recalculateLeaderboard } from './leaderboard-service-v2';

// ============================================================================
// TYPES
// ============================================================================

export interface AccountDeletionResult {
  success: boolean;
  message: string;
  deleted_at: string;
  challenges_transferred: number;
  challenges_deleted: number;
  data_summary: {
    check_ins: number;
    challenge_participations: number;
    notifications: number;
    comments: number;
    reactions: number;
  };
}

export interface ChallengeWithMembers {
  id: string;
  name: string;
  creator_id: string;
  member_count: number;
  oldest_member_id: string | null;
  oldest_member_name: string | null;
}

type AdminClient = ReturnType<typeof createAdminSupabase>;

interface DbError {
  code?: string;
  message?: string;
}

/**
 * Thrown when a step that must succeed fails. The message names the step and
 * carries the database message and code, never row data.
 */
export class AccountDeletionError extends Error {
  readonly step: string;
  readonly code?: string;

  constructor(step: string, cause?: DbError | null) {
    const reason = cause?.message || 'unknown error';
    const code = cause?.code ? ` [${cause.code}]` : '';
    super(`Account deletion failed while ${step}: ${reason}${code}`);
    this.name = 'AccountDeletionError';
    this.step = step;
    this.code = cause?.code;
  }
}

// ============================================================================
// SCHEMA FACTS (supabase/migrations/000_baseline.sql + 078..087)
// ============================================================================

/**
 * Nullable columns that reference profiles(id) with NO ON DELETE action. Any
 * row still pointing at the user blocks the profile delete, so the reference is
 * cleared. The rows belong to other people (or to shared records) and stay.
 */
const NULLABLE_PROFILE_REFERENCES: ReadonlyArray<readonly [table: string, column: string]> = [
  ['fitcircle_members', 'invited_by'],
  ['challenge_participants', 'invited_by'],
  ['challenges', 'winner_user_id'],
  ['circle_invites', 'accepted_by'],
  ['circle_quests', 'created_by'],
  ['check_ins', 'verified_by'],
  ['comments', 'deleted_by'],
  ['notifications', 'sender_id'],
  ['team_members', 'removed_by'],
];

/**
 * Rows that block the profile delete and cannot be kept without the user:
 *  - circle_messages: sender_id is ON DELETE SET NULL, but the CHECK
 *    circle_messages_kind_shape requires a sender for user_text / user_photo.
 *  - challenge_logs.user_id, challenge_invites.inviter_id / invitee_id:
 *    NOT NULL with NO ON DELETE action.
 *  - exercise_logs before exercises: workout_exercises.exercise_id references
 *    exercises with no action, and the user's custom exercises cascade with the
 *    profile. Deleting the workouts first removes the dependency on the order
 *    in which Postgres fires the cascades.
 * Order matters: children first.
 */
const BLOCKING_USER_ROWS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['circle_messages', 'sender_id'],
  ['challenge_logs', 'user_id'],
  ['challenge_invites', 'inviter_id'],
  ['challenge_invites', 'invitee_id'],
  ['exercise_logs', 'user_id'],
  ['exercises', 'created_by'],
];

/** User-owned tables cleared explicitly. All of them also cascade with the profile. */
const USER_DATA_TABLES: ReadonlyArray<readonly [table: string, column: string]> = [
  ['notifications', 'user_id'],
  ['check_ins', 'user_id'],
  ['daily_tracking', 'user_id'],
  ['comments', 'user_id'],
  ['reactions', 'user_id'],
  ['achievements', 'user_id'],
  ['circle_invites', 'inviter_id'],
  ['circle_encouragements', 'from_user_id'],
  ['circle_encouragements', 'to_user_id'],
  ['circle_check_ins', 'user_id'],
  ['daily_high_five_limits', 'user_id'],
  ['engagement_streaks', 'user_id'],
  ['engagement_activities', 'user_id'],
  ['metric_streaks', 'user_id'],
  ['food_log_images', 'user_id'],
  ['food_log_shares', 'owner_id'],
  ['food_log_audit', 'user_id'],
  ['food_log_entries', 'user_id'],
  ['privacy_settings', 'user_id'],
  ['daily_goals', 'user_id'],
  ['weekly_goals', 'user_id'],
  ['token_blacklist', 'user_id'],
  // Payments are kept until the profile delete for financial record keeping;
  // payments.user_id is ON DELETE CASCADE, so they go with the profile.
];

// ============================================================================
// STORAGE FACTS (every `.storage.from(` in apps/web/app)
// ============================================================================

/** Objects are stored as `<userId>/...` (any depth). */
const USER_FOLDER_BUCKETS: readonly string[] = [
  'food-logs', // food-log-image-service: <userId>/<yyyy>/<mm>/<entryId>/<imageId>_<size>.jpg
  'beverage-logs', // beverage-log-image-service: same layout
  'fitcircle-media', // api/upload: <userId>/<type>/<timestamp>-<random>.<ext>
  'nutrition-training', // nutrition-training-service: <userId>/<sha256>.<ext>
];

/** Objects are stored as `<folder>/<userId>_<timestamp>.<ext>` (one shared folder). */
const USER_FILE_PREFIX_BUCKETS: ReadonlyArray<{ bucket: string; folder: string }> = [
  { bucket: 'avatars', folder: 'avatars' }, // api/mobile/upload/avatar
  { bucket: 'checkin-photos', folder: 'checkin-photos' }, // api/mobile/upload/checkin-photo
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_PAGE_SIZE = 100;
const STORAGE_MAX_DEPTH = 8;
const STORAGE_MAX_OBJECTS_PER_BUCKET = 20_000;
const STORAGE_URL_PATTERN = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

function isMissingRelation(error: DbError | null | undefined): boolean {
  if (!error) return false;
  const text = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' || // undefined_table
    error.code === '42703' || // undefined_column
    error.code === 'PGRST204' || // column not in the schema cache
    error.code === 'PGRST205' || // table not in the schema cache
    text.includes('does not exist') ||
    text.includes('could not find')
  );
}

function isSafeSegment(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

/**
 * The only rule that decides whether an object may be removed. Exported for tests.
 *  - user-folder buckets:   the first path segment is exactly the user id
 *  - file-prefix buckets:   `<folder>/<userId>_...`, directly inside the folder
 * Any other bucket, and any path with empty, `.` or `..` segments: never.
 */
export function isUserOwnedStoragePath(bucket: string, path: string, userId: string): boolean {
  if (!UUID_PATTERN.test(userId) || typeof path !== 'string' || !path) return false;
  const segments = path.split('/');
  if (!segments.every(isSafeSegment)) return false;

  if (USER_FOLDER_BUCKETS.includes(bucket)) {
    return segments.length >= 2 && segments[0].toLowerCase() === userId.toLowerCase();
  }
  const rule = USER_FILE_PREFIX_BUCKETS.find((r) => r.bucket === bucket);
  if (rule) {
    return (
      segments.length === 2 &&
      segments[0] === rule.folder &&
      segments[1].toLowerCase().startsWith(`${userId.toLowerCase()}_`)
    );
  }
  return false;
}

// ============================================================================
// ACCOUNT DELETION SERVICE
// ============================================================================

/**
 * Service for handling account deletion with proper handling of shared resources.
 *
 * Key principles:
 * 1. Only delete the user's personal data
 * 2. Preserve FitCircles/challenges that have other members
 * 3. Transfer ownership of shared challenges to another member
 * 4. Maintain data integrity for other users
 *
 * PostgREST has no multi-statement transaction and the project keeps business
 * logic out of the database, so the deletion is a sequence of idempotent steps
 * ordered so that a failure leaves the account usable and a second call
 * finishes the job:
 *
 *   A. Resolve everything that would block the profile delete without removing
 *      any of the user's data (transfer ownership, clear references).
 *      A failure here throws; nothing has been deleted.
 *   B. Remove the user's files from storage (logged, never fatal).
 *   C. Delete the user's rows, children first.
 *   D. Revoke the Sign in with Apple token (never fatal), delete the profile,
 *      delete the auth user.
 *
 * Following FitCircle architecture: ALL business logic in TypeScript services, not stored procedures.
 */
export class AccountDeletionService {
  /**
   * Delete user account and all associated data
   * Handles shared resources (challenges/FitCircles) appropriately
   */
  static async deleteAccount(
    userId: string,
    options: {
      confirmEmail?: string;
      userEmail?: string;
      ipAddress?: string;
    } = {}
  ): Promise<AccountDeletionResult> {
    const { confirmEmail, userEmail, ipAddress } = options;

    if (!userId) {
      throw new Error('User id is required');
    }
    if (confirmEmail && userEmail && confirmEmail !== userEmail) {
      throw new Error('Email confirmation does not match');
    }

    const db = createAdminSupabase();

    console.log(`[AccountDeletionService] Starting account deletion for user: ${userId}`);

    // Audit trail of the request. Not fatal: on a second attempt the profile may
    // already be gone, and user_consent.user_id references it.
    const { error: auditError } = await db.from('user_consent').insert({
      user_id: userId,
      consent_type: 'data_deletion',
      consent_given: true,
      consent_version: 'deletion-request',
      consent_text: 'User requested account and data deletion under GDPR Article 17',
      consent_method: 'api',
      metadata: {
        deletion_timestamp: new Date().toISOString(),
        ip_address: ipAddress || 'unknown',
        user_email: userEmail,
      },
    });
    if (auditError) {
      console.warn(
        `[AccountDeletionService] Deletion request not logged: ${auditError.message ?? 'unknown error'}`
      );
    }

    const dataSummary = await this.countUserData(db, userId);

    // ------------------------------------------------------------------------
    // A. Resolve blockers. Nothing of the user's is deleted in this phase.
    // ------------------------------------------------------------------------
    const owned = await this.resolveOwnedCircles(db, userId);
    await this.transferCreatedChallenges(db, userId, new Set(owned.toDelete));
    await this.clearProfileReferences(db, userId);

    const memberCircleIds = await this.getMemberCircleIds(db, userId, owned.toDelete);
    const joinedChallengeIds = await this.getJoinedChallengeIds(db, userId);

    // ------------------------------------------------------------------------
    // B. Files. Needs the rows, so it runs before they are deleted.
    // ------------------------------------------------------------------------
    await this.removeStoredFiles(db, userId);

    // ------------------------------------------------------------------------
    // C. Rows, children first.
    // ------------------------------------------------------------------------
    for (const [table, column] of BLOCKING_USER_ROWS) {
      await this.deleteRows(db, table, column, userId, `deleting ${table} rows of the user`);
    }
    await this.deleteSystemPostsAbout(db, userId);

    let circlesDeleted = 0;
    for (const circleId of owned.toDelete) {
      await this.deleteCircle(db, circleId);
      circlesDeleted++;
    }

    await this.deleteRows(db, 'challenge_participants', 'user_id', userId, 'removing challenge participations');
    await this.deleteRows(db, 'fitcircle_members', 'user_id', userId, 'removing circle memberships');
    await this.deleteRows(db, 'team_members', 'user_id', userId, 'removing team memberships');

    await Promise.all(
      USER_DATA_TABLES.map(async ([table, column]) => {
        const { error } = await db.from(table).delete().eq(column, userId);
        if (error && !isMissingRelation(error)) {
          // Not fatal: every table here is ON DELETE CASCADE from profiles.
          console.warn(`[AccountDeletionService] Could not clear ${table}: ${error.message}`);
        }
      })
    );

    await this.refreshSharedCounters(db, memberCircleIds, joinedChallengeIds);

    // ------------------------------------------------------------------------
    // D. Identity.
    // ------------------------------------------------------------------------
    await this.revokeAppleToken(userId);

    // Consent records go last, the deletion request logged above included.
    const { error: consentError } = await db.from('user_consent').delete().eq('user_id', userId);
    if (consentError && !isMissingRelation(consentError)) {
      console.warn(`[AccountDeletionService] Could not clear user_consent: ${consentError.message}`);
    }

    const { error: profileDeleteError } = await db.from('profiles').delete().eq('id', userId);
    if (profileDeleteError) {
      console.error(
        `[AccountDeletionService] Profile delete failed: ${profileDeleteError.message} [${profileDeleteError.code}]`
      );
      throw new AccountDeletionError('deleting the profile', profileDeleteError);
    }

    await this.deleteAuthUser(db, userId);

    console.log(`[AccountDeletionService] Account deleted: ${userId}`);

    return {
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
      deleted_at: new Date().toISOString(),
      challenges_transferred: owned.transferred,
      challenges_deleted: circlesDeleted,
      data_summary: dataSummary,
    };
  }

  // ==========================================================================
  // PHASE A: BLOCKERS
  // ==========================================================================

  /**
   * Circles the user created: transfer to the oldest other active member, or
   * mark for deletion when there is none. fitcircles.creator_id is ON DELETE
   * CASCADE, so a read error must stop the deletion: carrying on would delete
   * other members' circles together with the profile.
   */
  private static async resolveOwnedCircles(
    db: AdminClient,
    userId: string
  ): Promise<{ transferred: number; toDelete: string[] }> {
    const { data: circles, error } = await db
      .from('fitcircles')
      .select('id, creator_id')
      .eq('creator_id', userId);

    if (error) throw new AccountDeletionError('loading the circles the user owns', error);

    let transferred = 0;
    const toDelete: string[] = [];

    for (const circle of circles ?? []) {
      // No embedded `profiles(...)` here: fitcircle_members has two foreign keys
      // to profiles (user_id, invited_by), which makes the embed ambiguous.
      const { data: members, error: membersError } = await db
        .from('fitcircle_members')
        .select('user_id, joined_at')
        .eq('fitcircle_id', circle.id)
        .neq('user_id', userId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true })
        .limit(1);

      if (membersError) {
        throw new AccountDeletionError('loading the members of a circle the user owns', membersError);
      }

      const heir = members?.[0]?.user_id as string | undefined;
      if (heir) {
        await this.transferChallengeOwnership(circle.id, userId, heir, db);
        transferred++;
      } else {
        toDelete.push(circle.id);
      }
    }

    console.log(
      `[AccountDeletionService] Owned circles: ${transferred} transferred, ${toDelete.length} to delete`
    );
    return { transferred, toDelete };
  }

  /**
   * Transfer challenge ownership to another member
   */
  private static async transferChallengeOwnership(
    challengeId: string,
    oldCreatorId: string,
    newCreatorId: string,
    db: AdminClient = createAdminSupabase()
  ): Promise<void> {
    console.log(
      `[AccountDeletionService] Transferring circle ${challengeId} from ${oldCreatorId} to ${newCreatorId}`
    );

    const { error } = await db
      .from('fitcircles')
      .update({
        creator_id: newCreatorId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', challengeId)
      .eq('creator_id', oldCreatorId);

    if (error) {
      console.error('[AccountDeletionService] Error transferring circle ownership:', error.message);
      throw new AccountDeletionError('transferring circle ownership', error);
    }

    const { error: notifyError } = await db.from('notifications').insert({
      user_id: newCreatorId,
      type: 'system',
      channel: 'in_app',
      title: 'Challenge Ownership Transferred',
      body: `You are now the owner of a challenge. The previous owner deleted their account.`,
      related_challenge_id: challengeId,
      priority: 'high',
    });
    if (notifyError) {
      console.warn(
        `[AccountDeletionService] New owner not notified: ${notifyError.message ?? 'unknown error'}`
      );
    }
  }

  /**
   * challenges.creator_id is NOT NULL with no ON DELETE action. A challenge in a
   * circle that stays is handed to that circle's owner (after the transfers
   * above that is never the user). Challenges in circles that are about to be
   * deleted go with the circle.
   */
  private static async transferCreatedChallenges(
    db: AdminClient,
    userId: string,
    circlesToDelete: Set<string>
  ): Promise<void> {
    const { data: created, error } = await db
      .from('challenges')
      .select('id, fitcircle_id')
      .eq('creator_id', userId);

    if (error) {
      if (isMissingRelation(error)) return;
      throw new AccountDeletionError('loading the challenges the user created', error);
    }

    const circleIds = Array.from(
      new Set((created ?? []).map((c: { fitcircle_id: string }) => c.fitcircle_id))
    ).filter((id) => !circlesToDelete.has(id));

    for (const circleId of circleIds) {
      const { data: circle, error: circleError } = await db
        .from('fitcircles')
        .select('id, creator_id')
        .eq('id', circleId)
        .maybeSingle();

      if (circleError) throw new AccountDeletionError('loading the circle of a challenge', circleError);

      const owner = circle?.creator_id as string | undefined;
      if (!owner || owner === userId) {
        throw new AccountDeletionError('transferring a challenge the user created', {
          message: `circle ${circleId} has no other owner`,
        });
      }

      const { error: updateError } = await db
        .from('challenges')
        .update({ creator_id: owner, updated_at: new Date().toISOString() })
        .eq('fitcircle_id', circleId)
        .eq('creator_id', userId);

      if (updateError) {
        throw new AccountDeletionError('transferring a challenge the user created', updateError);
      }
    }
  }

  private static async clearProfileReferences(db: AdminClient, userId: string): Promise<void> {
    for (const [table, column] of NULLABLE_PROFILE_REFERENCES) {
      const { error } = await db
        .from(table)
        .update({ [column]: null })
        .eq(column, userId);

      if (error && !isMissingRelation(error)) {
        throw new AccountDeletionError(`clearing ${table}.${column}`, error);
      }
    }
  }

  /** Circles that stay and lose a member: their counters are refreshed at the end. */
  private static async getMemberCircleIds(
    db: AdminClient,
    userId: string,
    circlesToDelete: string[]
  ): Promise<string[]> {
    const { data } = await db
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    const gone = new Set(circlesToDelete);
    return Array.from(
      new Set((data ?? []).map((m: { fitcircle_id: string }) => m.fitcircle_id))
    ).filter((id) => !gone.has(id));
  }

  private static async getJoinedChallengeIds(db: AdminClient, userId: string): Promise<string[]> {
    const { data } = await db
      .from('challenge_participants')
      .select('challenge_id')
      .eq('user_id', userId);

    return Array.from(new Set((data ?? []).map((p: { challenge_id: string }) => p.challenge_id)));
  }

  // ==========================================================================
  // PHASE B: STORAGE
  // ==========================================================================

  /**
   * Remove the user's objects from every bucket the app writes to.
   * Never throws. Returns the number of objects removed.
   */
  private static async removeStoredFiles(db: AdminClient, userId: string): Promise<number> {
    if (!UUID_PATTERN.test(userId)) {
      console.warn('[AccountDeletionService] Storage cleanup skipped: user id is not a uuid');
      return 0;
    }

    let removed = 0;
    try {
      const candidates = new Map<string, Set<string>>();
      const add = (bucket: string, path: string) => {
        if (!candidates.has(bucket)) candidates.set(bucket, new Set());
        candidates.get(bucket)!.add(path);
      };

      for (const bucket of USER_FOLDER_BUCKETS) {
        for (const path of await this.listUserFolder(db, bucket, userId)) add(bucket, path);
      }
      for (const { bucket, folder } of USER_FILE_PREFIX_BUCKETS) {
        for (const path of await this.listUserFiles(db, bucket, folder, userId)) add(bucket, path);
      }
      for (const { bucket, path } of await this.getReferencedObjects(db, userId)) add(bucket, path);

      for (const [bucket, paths] of candidates) {
        // Last line of defence: whatever produced the path, only the user's own
        // prefix is ever removed.
        const own = Array.from(paths).filter((path) => isUserOwnedStoragePath(bucket, path, userId));
        for (let i = 0; i < own.length; i += STORAGE_PAGE_SIZE) {
          const chunk = own.slice(i, i + STORAGE_PAGE_SIZE);
          try {
            const { error } = await db.storage.from(bucket).remove(chunk);
            if (error) {
              console.warn(`[AccountDeletionService] Storage remove failed in ${bucket}: ${error.message}`);
            } else {
              removed += chunk.length;
            }
          } catch (err) {
            console.warn(
              `[AccountDeletionService] Storage remove failed in ${bucket}:`,
              err instanceof Error ? err.message : 'unknown error'
            );
          }
        }
      }
    } catch (err) {
      console.warn(
        '[AccountDeletionService] Storage cleanup failed:',
        err instanceof Error ? err.message : 'unknown error'
      );
    }

    console.log(`[AccountDeletionService] Storage objects removed: ${removed}`);
    return removed;
  }

  /** One folder, all pages. Null when the bucket or folder cannot be listed. */
  private static async listFolder(
    db: AdminClient,
    bucket: string,
    folder: string,
    search?: string
  ): Promise<Array<{ name: string; isFolder: boolean }> | null> {
    const entries: Array<{ name: string; isFolder: boolean }> = [];

    for (let offset = 0; offset < STORAGE_MAX_OBJECTS_PER_BUCKET; offset += STORAGE_PAGE_SIZE) {
      let page: Array<{ name?: string; id?: string | null }> | null = null;
      try {
        const { data, error } = await db.storage.from(bucket).list(folder, {
          limit: STORAGE_PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
          ...(search ? { search } : {}),
        });
        if (error) {
          console.warn(`[AccountDeletionService] Cannot list ${bucket}/${folder}: ${error.message}`);
          return entries.length > 0 ? entries : null;
        }
        page = data as Array<{ name?: string; id?: string | null }> | null;
      } catch (err) {
        console.warn(
          `[AccountDeletionService] Cannot list ${bucket}/${folder}:`,
          err instanceof Error ? err.message : 'unknown error'
        );
        return entries.length > 0 ? entries : null;
      }

      for (const entry of page ?? []) {
        if (!isSafeSegment(entry?.name)) continue;
        // Folders come back without an id.
        entries.push({ name: entry.name, isFolder: entry.id == null });
      }
      if (!page || page.length < STORAGE_PAGE_SIZE) break;
    }

    return entries;
  }

  /** Every object under `<userId>/`, any depth. */
  private static async listUserFolder(db: AdminClient, bucket: string, userId: string): Promise<string[]> {
    const files: string[] = [];
    const pending: Array<{ folder: string; depth: number }> = [{ folder: userId, depth: 1 }];

    while (pending.length > 0 && files.length < STORAGE_MAX_OBJECTS_PER_BUCKET) {
      const { folder, depth } = pending.pop()!;
      const entries = await this.listFolder(db, bucket, folder);
      if (!entries) continue;

      for (const entry of entries) {
        const path = `${folder}/${entry.name}`;
        if (entry.isFolder) {
          if (depth < STORAGE_MAX_DEPTH) pending.push({ folder: path, depth: depth + 1 });
        } else {
          files.push(path);
        }
      }
    }
    return files;
  }

  /** Objects named `<userId>_...` directly inside the shared folder. */
  private static async listUserFiles(
    db: AdminClient,
    bucket: string,
    folder: string,
    userId: string
  ): Promise<string[]> {
    // `search` only narrows the listing. It matches anywhere in the name, so
    // ownership is decided by isUserOwnedStoragePath, not by the search.
    const entries = await this.listFolder(db, bucket, folder, `${userId}_`);
    return (entries ?? []).filter((e) => !e.isFolder).map((e) => `${folder}/${e.name}`);
  }

  /**
   * Objects named by URL in the user's rows: the avatar and chat photos. Only
   * URLs of this project's storage are considered, and the caller keeps only
   * paths inside the user's own prefix.
   */
  private static async getReferencedObjects(
    db: AdminClient,
    userId: string
  ): Promise<Array<{ bucket: string; path: string }>> {
    const urls: unknown[] = [];

    try {
      const { data: profile } = await db
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId)
        .maybeSingle();
      urls.push(profile?.avatar_url);

      const { data: messages } = await db
        .from('circle_messages')
        .select('photo_url')
        .eq('sender_id', userId)
        .not('photo_url', 'is', null);
      for (const message of messages ?? []) urls.push(message?.photo_url);
    } catch (err) {
      console.warn(
        '[AccountDeletionService] Could not read photo urls:',
        err instanceof Error ? err.message : 'unknown error'
      );
    }

    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
    const objects: Array<{ bucket: string; path: string }> = [];

    for (const url of urls) {
      if (typeof url !== 'string' || !base || !url.startsWith(`${base}/`)) continue;
      const match = STORAGE_URL_PATTERN.exec(url);
      if (!match) continue;
      try {
        objects.push({ bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) });
      } catch {
        // Malformed escape sequence: not one of ours.
      }
    }
    return objects;
  }

  // ==========================================================================
  // PHASE C: ROWS
  // ==========================================================================

  /** Delete rows that must be gone. A missing table or column is not an error. */
  private static async deleteRows(
    db: AdminClient,
    table: string,
    column: string,
    value: string,
    step: string
  ): Promise<void> {
    const { error } = await db.from(table).delete().eq(column, value);
    if (error && !isMissingRelation(error)) {
      throw new AccountDeletionError(step, error);
    }
  }

  /**
   * System posts about the user ("… logged a meal", streak milestones). They
   * have no sender; the user is in system_payload.actors and their name is in
   * the rendered body. Nothing depends on them, so a failure is logged only.
   */
  private static async deleteSystemPostsAbout(db: AdminClient, userId: string): Promise<void> {
    try {
      const { error } = await db
        .from('circle_messages')
        .delete()
        .eq('kind', 'system_event')
        .contains('system_payload', { actors: [{ id: userId }] });
      if (error && !isMissingRelation(error)) {
        console.warn(`[AccountDeletionService] Could not delete system posts: ${error.message}`);
      }
    } catch (err) {
      console.warn(
        '[AccountDeletionService] Could not delete system posts:',
        err instanceof Error ? err.message : 'unknown error'
      );
    }
  }

  /**
   * Delete a circle the user owns that has no other active member.
   * challenge_logs.fitcircle_id and challenge_participants.fitcircle_id
   * reference fitcircles with no ON DELETE action, and circle_quests.challenge_id
   * references challenges the same way, so the children go first instead of
   * relying on the order in which Postgres fires the cascades.
   */
  private static async deleteCircle(db: AdminClient, circleId: string): Promise<void> {
    const step = 'deleting a circle without other members';
    await this.deleteRows(db, 'challenge_logs', 'fitcircle_id', circleId, step);
    await this.deleteRows(db, 'challenge_participants', 'fitcircle_id', circleId, step);
    await this.deleteRows(db, 'circle_quests', 'fitcircle_id', circleId, step);
    await this.deleteRows(db, 'challenges', 'fitcircle_id', circleId, step);
    await this.deleteRows(db, 'fitcircles', 'id', circleId, step);
    console.log(`[AccountDeletionService] Deleted circle ${circleId}`);
  }

  /** Member counts and leaderboards of the circles and challenges the user left. Never throws. */
  private static async refreshSharedCounters(
    db: AdminClient,
    circleIds: string[],
    challengeIds: string[]
  ): Promise<void> {
    const metricTypeMap: Record<string, 'steps' | 'weight_loss_pct' | 'checkin_streak'> = {
      step_count: 'steps',
      workout_frequency: 'checkin_streak',
      weight_loss: 'weight_loss_pct',
      custom: 'checkin_streak',
    };

    for (const circleId of circleIds) {
      try {
        const { data: circle } = await db
          .from('fitcircles')
          .select('id, type')
          .eq('id', circleId)
          .maybeSingle();
        if (!circle) continue;

        const { count } = await db
          .from('fitcircle_members')
          .select('id', { count: 'exact', head: true })
          .eq('fitcircle_id', circleId)
          .eq('status', 'active');
        if (typeof count === 'number') {
          await db.from('fitcircles').update({ participant_count: count }).eq('id', circleId);
        }

        const metricType = metricTypeMap[circle.type as string] || 'checkin_streak';
        await recalculateLeaderboard(circleId, 'daily', metricType, db);
      } catch (error) {
        console.error(
          `[AccountDeletionService] Could not refresh circle ${circleId}:`,
          error instanceof Error ? error.message : 'unknown error'
        );
      }
    }

    for (const challengeId of challengeIds) {
      try {
        const { count } = await db
          .from('challenge_participants')
          .select('id', { count: 'exact', head: true })
          .eq('challenge_id', challengeId)
          .eq('status', 'active');
        if (typeof count === 'number') {
          await db.from('challenges').update({ participant_count: count }).eq('id', challengeId);
        }
      } catch (error) {
        console.error(
          `[AccountDeletionService] Could not refresh challenge ${challengeId}:`,
          error instanceof Error ? error.message : 'unknown error'
        );
      }
    }
  }

  // ==========================================================================
  // PHASE D: IDENTITY
  // ==========================================================================

  /**
   * Sign in with Apple: revoke the stored refresh token. Never throws and never
   * stops the deletion. The row itself cascades with the profile.
   */
  private static async revokeAppleToken(userId: string): Promise<void> {
    try {
      if (!AppleTokenService.isConfigured()) return;

      const refreshToken = await AppleTokenService.getStoredRefreshToken(userId);
      if (!refreshToken) return;

      const revoked = await AppleTokenService.revokeToken(refreshToken);
      console.log(
        `[AccountDeletionService] Apple token revocation ${revoked ? 'succeeded' : 'failed'} for user: ${userId}`
      );
    } catch (error) {
      console.warn(
        '[AccountDeletionService] Apple token revocation failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
    }
  }

  /** Delete the auth user. Already gone counts as done. One retry. */
  private static async deleteAuthUser(db: AdminClient, userId: string): Promise<void> {
    let lastError: { message?: string; code?: string; status?: number } | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const { error } = await db.auth.admin.deleteUser(userId);
      if (!error) return;

      const text = (error.message ?? '').toLowerCase();
      if (error.status === 404 || error.code === 'user_not_found' || text.includes('user not found')) {
        return;
      }
      lastError = error;
      console.error(
        `[AccountDeletionService] Auth user delete failed (attempt ${attempt}): ${error.message}`
      );
    }

    throw new AccountDeletionError('deleting the auth account', lastError);
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================

  /**
   * Count user data for deletion summary
   */
  private static async countUserData(
    db: AdminClient,
    userId: string
  ): Promise<{
    check_ins: number;
    challenge_participations: number;
    notifications: number;
    comments: number;
    reactions: number;
  }> {
    const countOf = async (table: string): Promise<number> => {
      try {
        const { count } = await db
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        return count || 0;
      } catch {
        return 0;
      }
    };

    const [check_ins, challenge_participations, notifications, comments, reactions] =
      await Promise.all([
        countOf('check_ins'),
        countOf('fitcircle_members'),
        countOf('notifications'),
        countOf('comments'),
        countOf('reactions'),
      ]);

    return { check_ins, challenge_participations, notifications, comments, reactions };
  }

  /**
   * Export all user data (for GDPR Article 15: Right to Access)
   * This should be called BEFORE account deletion if user wants a data export
   */
  static async exportUserData(userId: string): Promise<any> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`📥 [AccountDeletionService] Exporting data for user: ${userId}`);

    const [
      { data: profile },
      { data: checkIns },
      { data: dailyTracking },
      { data: challenges },
      { data: participations },
      { data: notifications },
      { data: comments },
      { data: reactions },
      { data: achievements },
      { data: consents },
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
      supabaseAdmin.from('check_ins').select('*').eq('user_id', userId),
      supabaseAdmin.from('daily_tracking').select('*').eq('user_id', userId),
      supabaseAdmin.from('fitcircles').select('*').eq('creator_id', userId),
      supabaseAdmin.from('fitcircle_members').select('*').eq('user_id', userId),
      supabaseAdmin.from('notifications').select('*').eq('user_id', userId),
      supabaseAdmin.from('comments').select('*').eq('user_id', userId),
      supabaseAdmin.from('reactions').select('*').eq('user_id', userId),
      supabaseAdmin.from('achievements').select('*').eq('user_id', userId),
      supabaseAdmin.from('user_consent').select('*').eq('user_id', userId),
    ]);

    return {
      export_date: new Date().toISOString(),
      user_id: userId,
      profile,
      activity_data: {
        check_ins: checkIns || [],
        daily_tracking: dailyTracking || [],
      },
      challenges: {
        created: challenges || [],
        participated: participations || [],
      },
      social: {
        notifications: notifications || [],
        comments: comments || [],
        reactions: reactions || [],
      },
      achievements: achievements || [],
      privacy: {
        consents: consents || [],
      },
    };
  }
}
