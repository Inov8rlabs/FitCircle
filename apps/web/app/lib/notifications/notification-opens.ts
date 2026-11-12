/**
 * Push open tracking (docs/PUSH_NOTIFICATIONS.md §7): the app reports a tap on a
 * push with the payload's `notification_id` (= notification_log.id) and the
 * row's `opened_at` is set — first open only, so retries and repeat taps are
 * harmless. The tapped action id (if any) is kept in data.openedAction.
 */
import { createAdminSupabase } from '../supabase-admin';

export type MarkOpenedResult = 'opened' | 'already_opened' | 'not_found';

/** Action ids are short snake/kebab tokens (default, log_meal, snooze, ...). */
export const OPEN_ACTION_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export async function markNotificationOpened(
  userId: string,
  notificationId: string,
  opts: { action?: string; now?: Date } = {}
): Promise<MarkOpenedResult> {
  const db = createAdminSupabase();
  const { data: row, error } = await db
    .from('notification_log')
    .select('id, opened_at, data')
    .eq('id', notificationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`notification_log read failed: ${error.message}`);
  if (!row) return 'not_found';
  const current = row as { opened_at: string | null; data: Record<string, unknown> | null };
  if (current.opened_at) return 'already_opened';

  const patch: Record<string, unknown> = { opened_at: (opts.now ?? new Date()).toISOString() };
  if (opts.action) patch.data = { ...(current.data ?? {}), openedAction: opts.action };
  // Conditional on opened_at still null: a concurrent first open wins once.
  const { data: updated, error: updateError } = await db
    .from('notification_log')
    .update(patch)
    .eq('id', notificationId)
    .eq('user_id', userId)
    .is('opened_at', null)
    .select('id');
  if (updateError) throw new Error(`notification_log update failed: ${updateError.message}`);
  return (updated ?? []).length > 0 ? 'opened' : 'already_opened';
}
