/**
 * Engage delivery (docs/ENGAGE_SPEC.md §5, §7, §8, §15):
 *  - GET /api/mobile/engage: eligible content cards per placement + in-app
 *    messages (platform match, segment + filters, dismissals, caps, variant
 *    assignment with control holdout, override merge, personalisation, asset
 *    expansion), prefetch list, and the home_hero ⇄ campaign merge;
 *  - POST /api/mobile/engage/events: batched interaction + app events, with
 *    impression dedupe and permanent card dismissals;
 *  - shared push/email rendering helpers used by the cron and test sends.
 */
import { Resend } from 'resend';

import { campaignPageUrl, CAMPAIGN_SITE } from '../campaigns/unsubscribe';
import { campaignEmail } from '../email/campaign-emails';
import type { RenderedEmail } from '../email/referral-emails';
import { CONTROL, assignVariant } from '../engage/assignment';
import { filterKeys, matchesFilters, snapshotFor } from '../engage/attributes';
import { isLive, type MessageRow } from '../engage/model';
import { platformAllowed } from '../engage/platform';
import { DEFAULT_IAM_MIN_HOURS, GLOBAL_CAPS, IMPRESSION_DEDUPE_MINUTES, MAX_EVENT_AGE_DAYS } from '../engage/policy';
import { assetIdsOf, mergeOverride, personalise, renderContent, type PersonalVars } from '../engage/render';
import { eventBatchSchema } from '../engage/schema';
import {
  PLACEMENT_MAX,
  type AssetRef,
  type CardLayout,
  type CardView,
  type EmailContent,
  type EngageAction,
  type EngagePlatform,
  type EngageResponse,
  type FilterCondition,
  type InAppLayout,
  type InAppView,
  type MessageContent,
  type MessageVariant,
  type Placement,
  type PushContent,
} from '../engage/types';
import { daysBetween, localDayOf, localToday } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { CampaignService } from './campaign-service';
import { EngageAssetService } from './engage-asset-service';
import { PushService } from './push-service';

type Profile = Record<string, any>;

/** Screens push payloads may route to (NotificationScreen in the orchestrator). */
export const PUSH_SCREENS = [
  'dashboard', 'food_log', 'exercise_log', 'circles', 'circle_detail', 'circle_chat', 'challenges', 'streaks', 'invite_hub', 'campaign',
] as const;

export interface PushRouting {
  screen: string;
  campaignSlug: string | null;
  actionType: string;
  actionValue: string | null;
}

/** §9: the push `screen` comes from the message action. */
export function actionToPush(action: EngageAction | null | undefined): PushRouting {
  const type = action?.type ?? 'deeplink';
  const value = action?.value ?? null;
  const base = { actionType: type, actionValue: value, campaignSlug: null as string | null };
  switch (type) {
    case 'deeplink':
    case 'screen':
      return { ...base, screen: value && (PUSH_SCREENS as readonly string[]).includes(value) ? value : 'dashboard' };
    case 'campaign':
      return { ...base, screen: value ? 'campaign' : 'dashboard', campaignSlug: value };
    case 'invite':
      return { ...base, screen: 'invite_hub' };
    case 'start_circle':
      return { ...base, screen: 'circles', campaignSlug: value };
    default:
      return { ...base, screen: 'dashboard' };
  }
}

export function emailCtaUrl(action: EngageAction | null | undefined): string {
  if (action?.type === 'url' && action.value && /^https:\/\//.test(action.value)) return action.value;
  if ((action?.type === 'campaign' || action?.type === 'start_circle') && action.value) return campaignPageUrl(action.value);
  return `${CAMPAIGN_SITE}/dashboard`;
}

export function renderPushFor(
  row: Pick<MessageRow, 'channel'>,
  variant: MessageVariant<any>,
  platform: EngagePlatform | null,
  vars: PersonalVars,
  assets: Map<string, AssetRef>
): { title: string; body: string; imageUrl: string | null; action: EngageAction } {
  const c = mergeOverride(variant, platform) as PushContent;
  const img = c.image?.assetId ? assets.get(c.image.assetId) : undefined;
  return { title: personalise(c.title, vars), body: personalise(c.body, vars), imageUrl: img?.url ?? null, action: c.action ?? { type: 'deeplink', value: 'dashboard' } };
}

export function renderEmailFor(
  row: Pick<MessageRow, 'channel'>,
  variant: MessageVariant<any>,
  platform: EngagePlatform | null,
  vars: PersonalVars,
  assets: Map<string, AssetRef>,
  unsubscribeUrl: string
): RenderedEmail {
  const c = mergeOverride(variant, platform) as EmailContent;
  const img = c.image?.assetId ? assets.get(c.image.assetId) : undefined;
  const header = img ? img.variants.find((v) => v.width >= 960 && v.format !== 'webp')?.url ?? img.url : null;
  return campaignEmail({
    subject: personalise(c.subject, vars),
    preheader: personalise(c.preheader ?? '', vars),
    heading: personalise(c.heading, vars),
    body: personalise(c.body, vars),
    ctaLabel: personalise(c.ctaLabel, vars) || 'Open FitCircle',
    ctaUrl: emailCtaUrl(c.action),
    headerImageUrl: header,
    unsubscribeUrl,
  });
}

let resend: Resend | null = null;

export interface GetEngageOptions {
  platform: EngagePlatform | null;
  appVersion?: string | null;
  timezone?: string | null;
  now?: Date;
}

interface EventRow {
  message_id: string;
  at: string;
}

export class EngageDeliveryService {
  /** {{first_name}}, {{streak}}, {{circle_name}}, {{days_left}} per user (only the keys asked for). */
  static async personalVars(
    userIds: string[],
    opts: { campaignId?: string | null; keys?: Set<string>; profiles?: Profile[]; today?: string } = {}
  ): Promise<Map<string, PersonalVars>> {
    const out = new Map<string, PersonalVars>();
    const ids = [...new Set(userIds)];
    if (!ids.length) return out;
    const want = (k: string) => !opts.keys || opts.keys.has(k);
    const supabase = createAdminSupabase();
    let profiles = opts.profiles;
    if (!profiles && want('first_name')) {
      const { data } = await supabase.from('profiles').select('id, display_name, username').in('id', ids);
      profiles = (data ?? []) as Profile[];
    }
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    const streaks = new Map<string, number>();
    if (want('streak')) {
      const { data } = await supabase.from('engagement_streaks').select('user_id, current_streak').in('user_id', ids);
      for (const s of (data ?? []) as Array<{ user_id: string; current_streak: number | null }>) streaks.set(s.user_id, s.current_streak ?? 0);
    }
    const circleNames = new Map<string, string>();
    if (want('circle_name')) {
      const { data: mem } = await supabase.from('fitcircle_members').select('user_id, fitcircle_id').in('user_id', ids).eq('status', 'active');
      const rows = (mem ?? []) as Array<{ user_id: string; fitcircle_id: string }>;
      const cids = [...new Set(rows.map((r) => r.fitcircle_id))];
      if (cids.length) {
        const { data: circles } = await supabase.from('fitcircles').select('id, name, status').in('id', cids).in('status', ['upcoming', 'active']);
        const names = new Map(((circles ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
        for (const r of rows) if (!circleNames.has(r.user_id) && names.has(r.fitcircle_id)) circleNames.set(r.user_id, names.get(r.fitcircle_id)!);
      }
    }
    let daysLeft: number | null = null;
    if (opts.campaignId && want('days_left')) daysLeft = await this.campaignDaysLeft(opts.campaignId, opts.today ?? localToday('America/Los_Angeles'));
    for (const id of ids) {
      const p = byId.get(id);
      const first = (p?.display_name || p?.username || '').trim().split(/\s+/)[0] || null;
      out.set(id, {
        first_name: first,
        streak: want('streak') ? streaks.get(id) ?? 0 : null,
        circle_name: circleNames.get(id) ?? null,
        days_left: daysLeft,
      });
    }
    return out;
  }

  static async campaignDaysLeft(campaignId: string, today: string): Promise<number | null> {
    const { data } = await createAdminSupabase().from('campaigns').select('starts_at, ends_at').eq('id', campaignId).maybeSingle();
    const c = data as { starts_at: string; ends_at: string } | null;
    if (!c || today < c.starts_at || today > c.ends_at) return null;
    return daysBetween(today, c.ends_at) + 1;
  }

  // ---------------------------------------------------------------- GET /api/mobile/engage

  static async getEngage(profile: Profile, opts: GetEngageOptions): Promise<EngageResponse> {
    const now = opts.now ?? new Date();
    const userId: string = profile.id;
    const platform = opts.platform;
    const supabase = createAdminSupabase();
    const today = localDayOf(now, opts.timezone);

    const { data: rowsData, error } = await supabase
      .from('engage_messages')
      .select('*')
      .in('channel', ['content_card', 'in_app'])
      .is('archived_at', null);
    if (error) throw error;
    const rows = (rowsData ?? []) as MessageRow[];
    const previewing = (r: MessageRow) => (r.preview_user_ids ?? []).includes(userId);
    const candidates = rows.filter((r) => previewing(r) || (isLive(r, now) && platformAllowed(r.platforms, platform)));

    // Segments
    const segIds = [...new Set(candidates.map((r) => r.segment_id).filter(Boolean))] as string[];
    const segFilters = new Map<string, FilterCondition[]>();
    if (segIds.length) {
      const { data: segs, error: segErr } = await supabase.from('engage_segments').select('id, filters, archived_at').in('id', segIds);
      if (segErr) throw segErr;
      for (const s of (segs ?? []) as Array<{ id: string; filters: FilterCondition[] | null; archived_at: string | null }>) {
        if (!s.archived_at) segFilters.set(s.id, s.filters ?? []);
      }
    }
    const filtersOf = (r: MessageRow): FilterCondition[] | null => {
      if (r.segment_id && !segFilters.has(r.segment_id)) return null; // missing segment → nobody
      return [...(r.segment_id ? segFilters.get(r.segment_id)! : []), ...(r.audience_filters ?? [])];
    };
    const needed = filterKeys(...candidates.map((r) => filtersOf(r) ?? []));
    const snap = needed.size ? await snapshotFor(profile as any, { keys: needed, platform, appVersion: opts.appVersion, now }) : null;

    // History: dismissals, impressions, exposures.
    const ids = rows.map((r) => r.id);
    const [dismissed, impressions, exposures] = await Promise.all([
      ids.length
        ? supabase.from('engage_dismissals').select('message_id').eq('user_id', userId).in('message_id', ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase.from('engage_events').select('message_id, at').eq('user_id', userId).eq('type', 'impression').in('message_id', ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase.from('engage_exposures').select('message_id').eq('user_id', userId).in('message_id', ids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [dismissed, impressions, exposures]) if ((r as any).error) throw (r as any).error;
    const dismissedSet = new Set(((dismissed.data ?? []) as Array<{ message_id: string }>).map((d) => d.message_id));
    const exposedSet = new Set(((exposures.data ?? []) as Array<{ message_id: string }>).map((d) => d.message_id));
    const imp = new Map<string, { count: number; last: string | null }>();
    for (const e of (impressions.data ?? []) as EventRow[]) {
      const cur = imp.get(e.message_id) ?? { count: 0, last: null };
      cur.count++;
      if (!cur.last || e.at > cur.last) cur.last = e.at;
      imp.set(e.message_id, cur);
    }
    const inAppIds = new Set(rows.filter((r) => r.channel === 'in_app').map((r) => r.id));
    const dayAgo = now.getTime() - 24 * 3600_000;
    const inApp24h = ((impressions.data ?? []) as EventRow[]).filter((e) => inAppIds.has(e.message_id) && new Date(e.at).getTime() >= dayAgo).length;

    // Eligibility + assignment
    type Chosen = { row: MessageRow; variant: MessageVariant<MessageContent> };
    const chosen: Chosen[] = [];
    const newExposures: Array<{ message_id: string; user_id: string; variant_id: string; platform: EngagePlatform | null; first_at: string }> = [];
    const expose = (r: MessageRow, variantId: string) => {
      if (exposedSet.has(r.id)) return;
      exposedSet.add(r.id);
      newExposures.push({ message_id: r.id, user_id: userId, variant_id: variantId, platform, first_at: now.toISOString() });
    };
    for (const r of candidates) {
      const variants = (r.variants ?? []) as MessageVariant<MessageContent>[];
      if (!variants.length) continue;
      if (previewing(r)) {
        const vid = assignVariant(userId, r.id, variants, r.control_weight);
        chosen.push({ row: r, variant: variants.find((v) => v.id === vid) ?? variants[0] });
        continue;
      }
      const filters = filtersOf(r);
      if (filters === null) continue;
      if (filters.length && (!snap || !matchesFilters(snap, filters))) continue;
      if (r.channel === 'content_card' && dismissedSet.has(r.id)) continue;
      const seen = imp.get(r.id);
      if (r.max_impressions_per_user && (seen?.count ?? 0) >= r.max_impressions_per_user) continue;
      if (r.channel === 'in_app') {
        const minH = r.min_hours_between ?? DEFAULT_IAM_MIN_HOURS;
        if (seen?.last && new Date(seen.last).getTime() + minH * 3600_000 > now.getTime()) continue;
      }
      const vid = assignVariant(userId, r.id, variants, r.control_weight);
      if (vid === CONTROL) {
        expose(r, CONTROL);
        continue;
      }
      const variant = variants.find((v) => v.id === vid);
      if (variant) chosen.push({ row: r, variant });
    }

    // Rendering inputs
    const assets = await EngageAssetService.refs(chosen.flatMap((c) => assetIdsOf([c.variant])));
    const campaignIds = [...new Set(chosen.map((c) => c.row.campaign_id).filter(Boolean))] as string[];
    const campaignSlug = new Map<string, string>();
    const daysLeft = new Map<string, number | null>();
    if (campaignIds.length) {
      const { data: cs } = await supabase.from('campaigns').select('id, slug, starts_at, ends_at').in('id', campaignIds);
      for (const c of (cs ?? []) as Array<{ id: string; slug: string; starts_at: string; ends_at: string }>) {
        campaignSlug.set(c.id, c.slug);
        daysLeft.set(c.id, today >= c.starts_at && today <= c.ends_at ? daysBetween(today, c.ends_at) + 1 : null);
      }
    }
    const baseVars = chosen.length ? (await this.personalVars([userId], { profiles: [profile], today })).get(userId) ?? {} : {};
    const render = (c: Chosen) =>
      renderContent(mergeOverride(c.variant, platform), { ...baseVars, days_left: c.row.campaign_id ? daysLeft.get(c.row.campaign_id) ?? null : null }, assets);

    // Cards per placement
    const byPlacement = new Map<Placement, Chosen[]>();
    for (const c of chosen) {
      if (c.row.channel !== 'content_card' || !c.row.placement) continue;
      byPlacement.set(c.row.placement, [...(byPlacement.get(c.row.placement) ?? []), c]);
    }
    const cards: Partial<Record<Placement, CardView[]>> = {};
    for (const [placement, list] of byPlacement) {
      list.sort(
        (a, b) =>
          Number(!!b.variant.content?.pinned) - Number(!!a.variant.content?.pinned) ||
          (b.row.priority ?? 0) - (a.row.priority ?? 0) ||
          b.row.starts_at.localeCompare(a.row.starts_at)
      );
      cards[placement] = list.slice(0, PLACEMENT_MAX[placement] ?? 1).map((c) => ({
        messageId: c.row.id,
        variantId: c.variant.id,
        layout: c.row.layout as CardLayout,
        placement,
        priority: c.row.priority ?? 0,
        content: render(c),
        campaignSlug: c.row.campaign_id ? campaignSlug.get(c.row.campaign_id) ?? null : null,
      }));
    }

    // home_hero ⇄ campaign experience
    let heroCampaignSlug: string | null = null;
    try {
      const hero = await CampaignService.heroCampaign(profile, opts.timezone ?? null, platform, now);
      const card = cards.home_hero?.[0];
      if (hero && (!card || hero.priority >= card.priority)) {
        heroCampaignSlug = hero.slug;
        delete cards.home_hero;
      }
    } catch (err: any) {
      console.error('[engage] hero campaign lookup failed:', err?.message);
    }

    // In-app
    const capReached = inApp24h >= GLOBAL_CAPS.inAppPer24h;
    const inApp: InAppView[] = chosen
      .filter((c) => c.row.channel === 'in_app' && c.row.trigger && (!capReached || !c.row.respect_global_cap || previewing(c.row)))
      .sort((a, b) => (b.row.priority ?? 0) - (a.row.priority ?? 0))
      .map((c) => ({
        messageId: c.row.id,
        variantId: c.variant.id,
        layout: c.row.layout as InAppLayout,
        priority: c.row.priority ?? 0,
        trigger: c.row.trigger!,
        content: render(c),
        maxImpressions: c.row.max_impressions_per_user,
        minHoursBetween: c.row.min_hours_between ?? DEFAULT_IAM_MIN_HOURS,
        impressionsSoFar: imp.get(c.row.id)?.count ?? 0,
        lastShownAt: imp.get(c.row.id)?.last ?? null,
        respectGlobalCap: c.row.respect_global_cap !== false,
      }));

    // Exposures for what's actually delivered (and the control holdout)
    const deliveredIds = new Set([...Object.values(cards).flat().map((c) => c.messageId), ...inApp.map((m) => m.messageId)]);
    for (const c of chosen) if (deliveredIds.has(c.row.id) && !previewing(c.row)) expose(c.row, c.variant.id);
    if (newExposures.length) {
      for (const e of newExposures) {
        const { error: exErr } = await supabase.from('engage_exposures').insert(e);
        if (exErr && (exErr as any).code !== '23505') console.error('[engage] exposure insert failed:', exErr.message);
      }
    }

    const prefetch = new Map<string, AssetRef>();
    for (const c of [...Object.values(cards).flat(), ...inApp]) if (c?.content.image) prefetch.set(c.content.image.id, c.content.image);

    return {
      cards,
      inApp,
      prefetch: [...prefetch.values()],
      heroCampaignSlug,
      caps: { inAppPer24h: GLOBAL_CAPS.inAppPer24h, inAppPerSession: GLOBAL_CAPS.inAppPerSession },
      fetchedAt: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------- POST /api/mobile/engage/events

  static async ingestEvents(userId: string, platform: EngagePlatform | null, body: unknown, now: Date = new Date()): Promise<{ accepted: number; dropped: number }> {
    const { events } = eventBatchSchema.parse(body);
    const supabase = createAdminSupabase();
    const oldest = now.getTime() - MAX_EVENT_AGE_DAYS * 86_400_000;
    const valid = events
      .map((e) => ({ ...e, atMs: Math.min(Date.parse(e.at), now.getTime()) }))
      .filter((e) => e.atMs >= oldest)
      .filter((e) => (e.type === 'app_event' ? !!e.name : !!e.messageId))
      .sort((a, b) => a.atMs - b.atMs);

    const msgIds = [...new Set(valid.map((e) => e.messageId).filter(Boolean))] as string[];
    const channel = new Map<string, string>();
    if (msgIds.length) {
      const { data } = await supabase.from('engage_messages').select('id, channel').in('id', msgIds);
      for (const m of (data ?? []) as Array<{ id: string; channel: string }>) channel.set(m.id, m.channel);
    }

    // Impression dedupe: one per message per user per 30 min.
    const window = IMPRESSION_DEDUPE_MINUTES * 60_000;
    const lastImp = new Map<string, number>();
    const impIds = [...new Set(valid.filter((e) => e.type === 'impression').map((e) => e.messageId!))].filter((id) => channel.has(id));
    if (impIds.length) {
      const since = new Date(Math.min(...valid.map((e) => e.atMs)) - window).toISOString();
      const { data } = await supabase
        .from('engage_events')
        .select('message_id, at')
        .eq('user_id', userId)
        .eq('type', 'impression')
        .in('message_id', impIds)
        .gte('at', since);
      for (const r of (data ?? []) as EventRow[]) {
        const t = Date.parse(r.at);
        if (t > (lastImp.get(r.message_id) ?? 0)) lastImp.set(r.message_id, t);
      }
    }

    const rows: Array<Record<string, unknown>> = [];
    const dismissals: string[] = [];
    for (const e of valid) {
      if (e.messageId && !channel.has(e.messageId)) continue; // unknown message
      if (e.type === 'impression') {
        const prev = lastImp.get(e.messageId!);
        if (prev !== undefined && e.atMs - prev < window) continue;
        lastImp.set(e.messageId!, e.atMs);
      }
      if (e.type === 'dismiss' && channel.get(e.messageId!) === 'content_card') dismissals.push(e.messageId!);
      rows.push({
        user_id: userId,
        message_id: e.type === 'app_event' ? e.messageId ?? null : e.messageId,
        variant_id: e.variantId ?? null,
        type: e.type,
        name: e.type === 'app_event' ? e.name : null,
        props: { ...(e.props ?? {}), ...(e.buttonIndex !== null && e.buttonIndex !== undefined ? { buttonIndex: e.buttonIndex } : {}) },
        platform,
        at: new Date(e.atMs).toISOString(),
        received_at: now.toISOString(),
      });
    }
    if (rows.length) {
      const { error } = await supabase.from('engage_events').insert(rows);
      if (error) throw error;
    }
    for (const id of [...new Set(dismissals)]) {
      const { error } = await supabase.from('engage_dismissals').insert({ message_id: id, user_id: userId, at: now.toISOString() });
      if (error && (error as any).code !== '23505') throw error;
    }
    return { accepted: rows.length, dropped: events.length - rows.length };
  }

  // ---------------------------------------------------------------- transports

  static async sendTestPush(
    userId: string,
    row: MessageRow,
    variantId: string,
    push: { title: string; body: string; action: EngageAction; imageUrl: string | null },
    platform: EngagePlatform | null
  ): Promise<number> {
    const route = actionToPush(push.action);
    const data: Record<string, string> = {
      type: 'engage',
      category: 'challenge',
      screen: route.screen,
      engageMessageId: row.id,
      variantId,
      actionType: route.actionType,
    };
    if (route.actionValue) data.actionValue = route.actionValue;
    if (route.campaignSlug) data.campaignSlug = route.campaignSlug;
    if (push.imageUrl) data.imageUrl = push.imageUrl;
    return PushService.sendPush(userId, { title: push.title, body: push.body, data, ...(platform ? { platforms: [platform] } : {}) });
  }

  static async sendEmail(to: string, email: RenderedEmail, unsubscribeUrl: string): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn('[Engage] RESEND_API_KEY not configured; email skipped');
      return false;
    }
    resend ??= new Resend(key);
    try {
      const { error } = await resend.emails.send({
        from: 'FitCircle <team@fitcircle.ai>',
        replyTo: 'team@fitcircle.ai',
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      if (error) {
        console.error('[Engage] Resend rejected email:', error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.error('[Engage] email send failed:', err?.message);
      return false;
    }
  }
}
