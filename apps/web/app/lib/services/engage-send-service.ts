/**
 * Engage push + email delivery (docs/ENGAGE_SPEC.md §9, §15), driven by
 * GET /api/cron/engage every 15 minutes.
 *
 *  - immediate → the next run; scheduled → from send_at; local_time → from
 *    local_hour in the user's timezone on send_at's date.
 *  - Audience = every profile matching segment + inline filters, paged; push
 *    reaches each user's active-token platforms ∩ message platforms ∩ {ios,
 *    android}; one send per user+platform (engage_deliveries dedupe).
 *  - Control users get a delivery row with variant 'control' (no send) and a
 *    control exposure, so they're measured but never contacted.
 *  - A run sends at most PUSH_PER_RUN / EMAIL_PER_RUN per message; when a scan
 *    completes the message is marked send_completed_at (local_time waits until
 *    the send date has passed everywhere).
 */
import { campaignUnsubscribeUrl } from '../campaigns/unsubscribe';
import { CONTROL, assignVariant } from '../engage/assignment';
import type { AttributeSnapshot, ProfileLite } from '../engage/attributes';
import { isLive, type MessageRow } from '../engage/model';
import { EMAIL_PER_RUN, PUSH_PER_RUN, PUSH_PLATFORMS } from '../engage/policy';
import { assetIdsOf, referencedKeys } from '../engage/render';
import type { EngagePlatform, FilterCondition, MessageVariant } from '../engage/types';
import { isValidTimezone } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { localDateHour } from './campaign-delivery-service';
import { EngageAssetService } from './engage-asset-service';
import { EngageDeliveryService, actionToPush, renderEmailFor, renderPushFor } from './engage-delivery-service';
import { EngageSegmentService } from './engage-segment-service';
import { NotificationOrchestrator } from './notification-orchestrator';

export const DEFAULT_TZ = 'America/Los_Angeles';

export interface EngageCronSummary {
  messages: number;
  push: { sent: number; control: number; skipped: number; failed: number };
  email: { sent: number; control: number; skipped: number; failed: number };
  completed: string[];
  errors: string[];
}

const tzOf = (tz: string | null | undefined) => (!tz || tz === 'UTC' || !isValidTimezone(tz) ? DEFAULT_TZ : tz);

/** Is the message due at all right now (message-level gate)? */
export function messageDue(row: Pick<MessageRow, 'send_mode' | 'send_at'>, now: Date): boolean {
  if (row.send_mode === 'immediate') return true;
  if (!row.send_at) return false;
  if (row.send_mode === 'scheduled') return now.getTime() >= Date.parse(row.send_at);
  if (row.send_mode === 'local_time') {
    // UTC+14 reaches the date first: 14 h before UTC midnight.
    const date = row.send_at.slice(0, 10);
    return now.getTime() >= Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000;
  }
  return false;
}

/** Is this user due (local_time checks their local date + hour)? */
export function userDue(row: Pick<MessageRow, 'send_mode' | 'send_at' | 'local_hour'>, timezone: string | null | undefined, now: Date): boolean {
  if (row.send_mode !== 'local_time') return true;
  const { date, hour } = localDateHour(tzOf(timezone), now);
  return date === row.send_at!.slice(0, 10) && hour >= (row.local_hour ?? 0);
}

/** local_time sends are complete once the date is over in UTC-12. */
function localWindowOver(row: Pick<MessageRow, 'send_at'>, now: Date): boolean {
  const date = row.send_at!.slice(0, 10);
  return now.getTime() >= Date.parse(`${date}T00:00:00Z`) + 36 * 3600_000;
}

export class EngageSendService {
  static async runCron(now: Date = new Date()): Promise<EngageCronSummary> {
    const summary: EngageCronSummary = {
      messages: 0,
      push: { sent: 0, control: 0, skipped: 0, failed: 0 },
      email: { sent: 0, control: 0, skipped: 0, failed: 0 },
      completed: [],
      errors: [],
    };
    const { data, error } = await createAdminSupabase()
      .from('engage_messages')
      .select('*')
      .in('channel', ['push', 'email'])
      .eq('published', true)
      .is('archived_at', null)
      .is('send_completed_at', null);
    if (error) throw error;
    for (const row of (data ?? []) as MessageRow[]) {
      if (!isLive(row, now) || !messageDue(row, now)) continue;
      summary.messages++;
      try {
        await this.deliver(row, now, summary);
      } catch (err: any) {
        summary.errors.push(`${row.id}: ${err?.message ?? err}`);
      }
    }
    return summary;
  }

  /** Target platforms for a push message (§15: web push unsupported). */
  static pushTargets(row: Pick<MessageRow, 'platforms'>): EngagePlatform[] {
    const want = row.platforms?.length ? row.platforms : [...PUSH_PLATFORMS];
    return want.filter((p) => (PUSH_PLATFORMS as readonly string[]).includes(p));
  }

  private static async deliver(row: MessageRow, now: Date, summary: EngageCronSummary) {
    const supabase = createAdminSupabase();
    const isPush = row.channel === 'push';
    const stats = isPush ? summary.push : summary.email;
    if (!isPush && !process.env.RESEND_API_KEY) return; // unconfigured: don't burn the audience
    const segment = await EngageSegmentService.filtersOf(row.segment_id);
    if (segment === null) {
      summary.errors.push(`${row.id}: segment missing`);
      return;
    }
    const filters: FilterCondition[] = [...segment, ...(row.audience_filters ?? [])];
    const variants = (row.variants ?? []);
    if (!variants.length) return;
    const targets = isPush ? this.pushTargets(row) : [];
    if (isPush && targets.length === 0) return;

    const texts = variants.flatMap((v) => [v.content, ...Object.values(v.platformOverrides ?? {})]).flatMap((c: any) => [c?.title, c?.body, c?.subject, c?.preheader, c?.heading, c?.ctaLabel]);
    const varKeys = referencedKeys(texts);
    const assets = await EngageAssetService.refs(assetIdsOf(variants));
    let budget = isPush ? PUSH_PER_RUN : EMAIL_PER_RUN;
    let exhausted = false;

    for await (const page of EngageSegmentService.audiencePages(filters, { extraKeys: isPush ? ['platform'] : ['email_opt_in'], now })) {
      // Who in this page still needs it, and on which platforms.
      const due: Array<{ p: ProfileLite; snap: AttributeSnapshot; platforms: string[] }> = [];
      for (const p of page.matching) {
        const snap = page.snapshots.get(p.id)!;
        if (!userDue(row, p.timezone, now)) continue;
        if (isPush) {
          const plats = snap.tokenPlatforms.filter((x) => targets.includes(x));
          if (plats.length) due.push({ p, snap, platforms: plats });
        } else if (snap.email_opt_in && p.email) {
          due.push({ p, snap, platforms: ['email'] });
        }
      }
      if (!due.length) continue;
      const { data: done, error } = await supabase
        .from('engage_deliveries')
        .select('user_id, platform')
        .eq('message_id', row.id)
        .in('user_id', due.map((d) => d.p.id));
      if (error) throw error;
      const sent = new Set(((done ?? []) as Array<{ user_id: string; platform: string }>).map((d) => `${d.user_id}|${d.platform}`));
      const pending = due
        .map((d) => ({ ...d, platforms: d.platforms.filter((x) => !sent.has(`${d.p.id}|${x}`)) }))
        .filter((d) => d.platforms.length);
      if (!pending.length) continue;

      const vars = varKeys.size
        ? await EngageDeliveryService.personalVars(pending.map((d) => d.p.id), { campaignId: row.campaign_id, keys: varKeys, profiles: pending.map((d) => d.p as any) })
        : new Map();

      for (const d of pending) {
        if (budget <= 0) {
          exhausted = true;
          break;
        }
        const variantId = assignVariant(d.p.id, row.id, variants, row.control_weight);
        // Claim each platform (UNIQUE makes concurrent runs send once).
        const claimed: string[] = [];
        for (const platform of d.platforms) {
          const { error: claimErr } = await supabase
            .from('engage_deliveries')
            .insert({ message_id: row.id, user_id: d.p.id, variant_id: variantId, channel: isPush ? 'push' : 'email', platform, sent_at: now.toISOString() });
          if (!claimErr) claimed.push(platform);
          else if ((claimErr as any).code !== '23505') stats.failed++;
        }
        if (!claimed.length) {
          stats.skipped++;
          continue;
        }
        const exposurePlatform = isPush ? (claimed[0] as EngagePlatform) : null;
        const { error: exErr } = await supabase
          .from('engage_exposures')
          .insert({ message_id: row.id, user_id: d.p.id, variant_id: variantId, platform: exposurePlatform, first_at: now.toISOString() });
        if (exErr && (exErr as any).code !== '23505') console.error('[engage-send] exposure insert failed:', exErr.message);
        if (variantId === CONTROL) {
          stats.control++;
          continue;
        }
        const variant = variants.find((v) => v.id === variantId)!;
        const v = vars.get(d.p.id) ?? {};
        budget--;
        try {
          if (isPush) {
            // One orchestrator send (one cap unit) to the claimed platforms; overrides follow the first platform.
            const push = renderPushFor(row, variant, claimed[0] as EngagePlatform, v, assets);
            const route = actionToPush(push.action);
            const res = await NotificationOrchestrator.send(d.p.id, 'engage', {
              title: push.title,
              body: push.body,
              screen: route.screen,
              campaignSlug: route.campaignSlug ?? undefined,
              engageMessageId: row.id,
              variantId,
              actionType: route.actionType,
              actionValue: route.actionValue ?? undefined,
              imageUrl: push.imageUrl ?? undefined,
              platforms: claimed,
            });
            if (res.sent) stats.sent++;
            else stats.skipped++;
          } else {
            const unsubscribe = campaignUnsubscribeUrl(d.p.id);
            const ok = await EngageDeliveryService.sendEmail(d.p.email!, renderEmailFor(row, variant, null, v, assets, unsubscribe), unsubscribe);
            if (ok) stats.sent++;
            else {
              stats.failed++;
              await supabase.from('engage_deliveries').delete().eq('message_id', row.id).eq('user_id', d.p.id).eq('platform', 'email');
            }
          }
        } catch (err: any) {
          stats.failed++;
          console.error('[engage-send] send failed:', row.id, err?.message);
        }
      }
      if (exhausted) break;
    }

    if (!exhausted && (row.send_mode !== 'local_time' || localWindowOver(row, now))) {
      await supabase.from('engage_messages').update({ send_completed_at: now.toISOString() }).eq('id', row.id);
      summary.completed.push(row.id);
    }
  }
}
