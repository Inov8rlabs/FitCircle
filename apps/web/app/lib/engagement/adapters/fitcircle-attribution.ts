/**
 * Outcome attribution: stamps engagement_sends.converted_at when a message's
 * goal happened inside its window after the send (or after the holdout row,
 * so control and treatment are measured the same way). Runs inside the hourly
 * lifecycle cron. FitCircle goal → table:
 *
 *   meal_logged    food_log_entries (food) created                     48 h
 *   circle_joined  fitcircle_members joined                           48 h
 *   invite_sent    referral_invites / circle_invites created           48 h
 *   active         any meal, workout or streak check-in               48 h
 *   growth slot (weekly report goal 'active+<slot>', stored in meta.growth_converted_at, 7 days):
 *     invite_friend → invite_sent · create_circle → circle_joined · join_campaign → campaign_participants
 *     try_fitzy → profiles.fitzy_opened_at · try_photo → a photo meal
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminSupabase } from '../../supabase-admin';

import type { AnalyticsSink } from './types';

type Db = SupabaseClient<any, any, any>;

export const GOAL_WINDOW_HOURS = 48;
export const GROWTH_WINDOW_HOURS = 7 * 24;
const SCAN_DAYS = 8;
const MAX_ROWS_PER_RUN = 400;

type Goal = 'meal_logged' | 'circle_joined' | 'invite_sent' | 'active' | 'campaign_joined' | 'fitzy_opened' | 'photo_meal';

const GROWTH_GOAL: Record<string, Goal> = {
  invite_friend: 'invite_sent',
  create_circle: 'circle_joined',
  join_campaign: 'campaign_joined',
  try_fitzy: 'fitzy_opened',
  try_photo: 'photo_meal',
};

/** Earliest goal event time in (from, to], or null. */
async function goalAt(db: Db, userId: string, goal: Goal, from: string, to: string): Promise<string | null> {
  const first = async (table: string, userCol: string, timeCol: string, extra?: (q: any) => any): Promise<string | null> => {
    let q = db.from(table).select(timeCol).eq(userCol, userId).gt(timeCol, from).lte(timeCol, to);
    if (extra) q = extra(q);
    const { data, error } = await q.order(timeCol, { ascending: true }).limit(1).maybeSingle();
    if (error) return null;
    return (data as Record<string, string> | null)?.[timeCol] ?? null;
  };
  const earliest = (xs: Array<string | null>) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
  switch (goal) {
    case 'meal_logged':
      return first('food_log_entries', 'user_id', 'created_at', (q) => q.eq('entry_type', 'food').is('deleted_at', null));
    case 'photo_meal':
      return first('food_log_entries', 'user_id', 'created_at', (q) => q.eq('entry_type', 'food').eq('input_method', 'photo'));
    case 'circle_joined':
      return first('fitcircle_members', 'user_id', 'joined_at');
    case 'invite_sent':
      return earliest(await Promise.all([first('referral_invites', 'inviter_id', 'created_at'), first('circle_invites', 'inviter_id', 'created_at')]));
    case 'campaign_joined':
      return first('campaign_participants', 'user_id', 'joined_at');
    case 'fitzy_opened':
      return first('profiles', 'id', 'fitzy_opened_at');
    case 'active':
      return earliest(
        await Promise.all([
          first('food_log_entries', 'user_id', 'created_at', (q) => q.is('deleted_at', null)),
          first('exercise_logs', 'user_id', 'created_at'),
          first('streak_claims', 'user_id', 'claimed_at'),
        ])
      );
  }
}

const plusHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

export async function attributeConversions(
  analytics: AnalyticsSink,
  opts: { now?: Date; db?: Db } = {}
): Promise<{ checked: number; converted: number; growthConverted: number }> {
  const db = opts.db ?? (createAdminSupabase() as Db);
  const now = (opts.now ?? new Date()).toISOString();
  const since = new Date(Date.parse(now) - SCAN_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from('engagement_sends')
    .select('id, user_id, message_key, period_key, channel, status, variant, goal_key, created_at, sent_at, converted_at, meta')
    .in('status', ['sent', 'holdout'])
    .not('goal_key', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS_PER_RUN);
  if (error) throw error;
  let converted = 0;
  let growthConverted = 0;
  const rows = (data ?? []) as any[];
  for (const r of rows) {
    const t0: string = r.sent_at ?? r.created_at;
    const [base, growth] = String(r.goal_key).split('+');
    const props = { message_key: r.message_key, variant: r.variant ?? '', period_key: r.period_key, channel: r.channel, status: r.status };
    if (!r.converted_at) {
      const at = await goalAt(db, r.user_id, base as Goal, t0, plusHours(t0, GOAL_WINDOW_HOURS));
      if (at) {
        const { data: up } = await db.from('engagement_sends').update({ converted_at: at }).eq('id', r.id).is('converted_at', null).select('id');
        if ((up ?? []).length) {
          converted++;
          analytics.track(r.user_id, 'Lifecycle Goal Converted', { ...props, goal: base, send_id: r.id }, `${r.id}:converted`);
        }
      }
    }
    if (growth && GROWTH_GOAL[growth] && !r.meta?.growth_converted_at && r.channel === 'email') {
      const at = await goalAt(db, r.user_id, GROWTH_GOAL[growth], t0, plusHours(t0, GROWTH_WINDOW_HOURS));
      if (at) {
        const { error: upErr } = await db.from('engagement_sends').update({ meta: { ...(r.meta ?? {}), growth_converted_at: at } }).eq('id', r.id);
        if (!upErr) {
          growthConverted++;
          analytics.track(r.user_id, 'Lifecycle Goal Converted', { ...props, goal: `growth_${growth}`, send_id: r.id }, `${r.id}:growth`);
        }
      }
    }
  }
  return { checked: rows.length, converted, growthConverted };
}
