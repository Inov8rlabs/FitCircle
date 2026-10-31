/**
 * Engage analytics (docs/ENGAGE_SPEC.md §10, §15): per-variant (+control) and
 * per-platform metrics, conversions within the goal window after a click or
 * impression (control: after exposure), lift vs control with a two-proportion
 * z-test p-value, a daily series, and the overview tiles.
 */
import { CONTROL } from '../engage/assignment';
import { computeMessageStatus, rowToMessage, type MessageRow } from '../engage/model';
import { PLATFORMS } from '../engage/platform';
import { lift, ratio, twoProportionPValue } from '../engage/stats';
import type { EngageMessage, EngagePlatform, MessageStats, MessageSummary, VariantStats } from '../engage/types';
import { createAdminSupabase } from '../supabase-admin';

import { EngageMessageService } from './engage-message-service';

interface Exposure { user_id: string; variant_id: string; platform: EngagePlatform | null; first_at: string }
interface Ev { user_id: string; variant_id: string | null; type: string; platform: EngagePlatform | null; at: string }
interface Delivery { user_id: string; variant_id: string; platform: string; sent_at: string }

const PAGE = 1000;
const CHUNK = 200;
const DAY = 86_400_000;

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export interface StatsOptions {
  from?: string | null;
  to?: string | null;
  platform?: EngagePlatform | null;
}

export type FullStats = MessageStats & {
  channel: string;
  platform: EngagePlatform | 'all';
  byPlatform: VariantStats[];
  funnel: { exposed: number; impressions: number; clicks: number; conversions: number };
};

export class EngageStatsService {
  static async stats(id: string, opts: StatsOptions = {}): Promise<FullStats> {
    const row = await EngageMessageService.fetchRow(id);
    const supabase = createAdminSupabase();
    const to = opts.to ? new Date(opts.to.length === 10 ? `${opts.to}T23:59:59.999Z` : opts.to) : new Date();
    const from = opts.from ? new Date(opts.from.length === 10 ? `${opts.from}T00:00:00Z` : opts.from) : new Date(row.starts_at);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const [exposures, events, deliveries] = await Promise.all([
      pageAll<Exposure>((a, b) =>
        supabase.from('engage_exposures').select('user_id, variant_id, platform, first_at').eq('message_id', id).gte('first_at', fromIso).lte('first_at', toIso).range(a, b)
      ),
      pageAll<Ev>((a, b) =>
        supabase.from('engage_events').select('user_id, variant_id, type, platform, at').eq('message_id', id).gte('at', fromIso).lte('at', toIso).range(a, b)
      ),
      pageAll<Delivery>((a, b) =>
        supabase.from('engage_deliveries').select('user_id, variant_id, platform, sent_at').eq('message_id', id).gte('sent_at', fromIso).lte('sent_at', toIso).range(a, b)
      ),
    ]);

    const variantOf = new Map(exposures.map((e) => [e.user_id, e.variant_id]));
    const platformOf = new Map(exposures.map((e) => [e.user_id, e.platform]));
    const evVariant = (e: { user_id: string; variant_id: string | null }) => e.variant_id ?? variantOf.get(e.user_id) ?? null;

    // Conversions: goal app events within the window after the basis.
    const goal = row.conversion;
    const convertedAt = new Map<string, string>();
    if (goal && exposures.length) {
      const windowMs = goal.windowHours * 3600_000;
      const basis = new Map<string, number[]>();
      const add = (u: string, at: string) => basis.set(u, [...(basis.get(u) ?? []), Date.parse(at)]);
      for (const x of exposures) if (x.variant_id === CONTROL) add(x.user_id, x.first_at);
      if (row.channel === 'push' || row.channel === 'email') {
        const openType = goal.basis === 'click' && row.channel === 'push' ? 'push_open' : null;
        if (openType) for (const e of events) if (e.type === openType) add(e.user_id, e.at);
        if (!openType) for (const d of deliveries) if (d.variant_id !== CONTROL) add(d.user_id, d.sent_at);
      } else {
        const t = goal.basis === 'click' ? 'click' : 'impression';
        for (const e of events) if (e.type === t) add(e.user_id, e.at);
      }
      const users = [...basis.keys()];
      const until = new Date(to.getTime() + windowMs).toISOString();
      for (let i = 0; i < users.length; i += CHUNK) {
        const part = users.slice(i, i + CHUNK);
        const goals = await pageAll<{ user_id: string; at: string }>((a, b) =>
          supabase.from('engage_events').select('user_id, at').eq('type', 'app_event').eq('name', goal.event).in('user_id', part).gte('at', fromIso).lte('at', until).order('at', { ascending: true }).range(a, b)
        );
        for (const g of goals) {
          if (convertedAt.has(g.user_id)) continue;
          const t = Date.parse(g.at);
          if ((basis.get(g.user_id) ?? []).some((b) => b <= t && t <= b + windowMs)) convertedAt.set(g.user_id, g.at);
        }
      }
    }

    const variantIds = [...(row.variants ?? []).map((v) => v.id)];
    if (row.control_weight > 0 || exposures.some((e) => e.variant_id === CONTROL)) variantIds.push(CONTROL);

    const compute = (platform: EngagePlatform | null): VariantStats[] => {
      const inPlat = (p: string | null | undefined) => platform === null || p === platform;
      const rows = variantIds.map((vid) => {
        const exp = exposures.filter((e) => e.variant_id === vid && inPlat(e.platform));
        const ev = events.filter((e) => evVariant(e) === vid && inPlat(e.platform ?? platformOf.get(e.user_id)));
        const imps = ev.filter((e) => e.type === 'impression');
        const uniqImp = new Set(imps.map((e) => e.user_id)).size;
        const uniqClicks = new Set(ev.filter((e) => e.type === 'click').map((e) => e.user_id)).size;
        const conversions = exp.filter((e) => convertedAt.has(e.user_id)).length;
        const del = deliveries.filter((d) => d.variant_id === vid && inPlat(d.platform === 'email' ? platformOf.get(d.user_id) ?? null : d.platform));
        const s: VariantStats = {
          variantId: vid,
          platform: platform ?? 'all',
          exposedUsers: exp.length,
          impressions: imps.length,
          uniqueImpressions: uniqImp,
          uniqueClicks: uniqClicks,
          ctr: ratio(uniqClicks, uniqImp),
          dismissals: ev.filter((e) => e.type === 'dismiss').length,
          conversions,
          conversionRate: goal ? ratio(conversions, exp.length) : null,
          liftVsControl: null,
          pValue: null,
        };
        if (row.channel === 'push') {
          s.pushSent = vid === CONTROL ? 0 : del.length;
          s.pushOpens = new Set(ev.filter((e) => e.type === 'push_open').map((e) => e.user_id)).size;
        }
        if (row.channel === 'email') s.emailSent = vid === CONTROL ? 0 : del.length;
        return s;
      });
      const control = rows.find((r) => r.variantId === CONTROL);
      if (control && goal) {
        for (const r of rows) {
          if (r === control) continue;
          r.liftVsControl = lift(r.conversionRate, control.conversionRate);
          r.pValue = twoProportionPValue(r.conversions, r.exposedUsers, control.conversions, control.exposedUsers);
        }
      }
      return rows;
    };

    const filterPlatform = opts.platform ?? null;
    const variants = compute(filterPlatform);
    const byPlatform = PLATFORMS.flatMap((p) => compute(p));

    // Daily series (UTC days)
    const daily: MessageStats['daily'] = [];
    const days = Math.min(400, Math.max(1, Math.ceil((to.getTime() - Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z')) / DAY)));
    const idx = new Map<string, MessageStats['daily'][number]>();
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z') + i * DAY).toISOString().slice(0, 10);
      const d = { date, impressions: 0, clicks: 0, conversions: 0 };
      daily.push(d);
      idx.set(date, d);
    }
    const inFilter = (e: Ev) => !filterPlatform || (e.platform ?? platformOf.get(e.user_id)) === filterPlatform;
    for (const e of events) {
      if (!inFilter(e)) continue;
      const d = idx.get(e.at.slice(0, 10));
      if (!d) continue;
      if (e.type === 'impression') d.impressions++;
      if (e.type === 'click' || e.type === 'push_open') d.clicks++;
    }
    for (const [u, at] of convertedAt) {
      if (filterPlatform && platformOf.get(u) !== filterPlatform) continue;
      if (variantOf.get(u) === CONTROL) continue;
      const d = idx.get(at.slice(0, 10));
      if (d) d.conversions++;
    }

    const treated = variants.filter((v) => v.variantId !== CONTROL);
    return {
      messageId: id,
      channel: row.channel,
      from: fromIso,
      to: toIso,
      platform: filterPlatform ?? 'all',
      variants,
      byPlatform,
      daily,
      funnel: {
        exposed: treated.reduce((s, v) => s + v.exposedUsers, 0),
        impressions: treated.reduce((s, v) => s + v.uniqueImpressions, 0),
        clicks: treated.reduce((s, v) => s + v.uniqueClicks, 0),
        conversions: treated.reduce((s, v) => s + v.conversions, 0),
      },
    };
  }

  /**
   * Light per-message stats for lists and the overview, for the last `days`
   * days, in three grouped queries regardless of how many messages:
   *  1. impression/click/push_open events for all the messages,
   *  2. push/email deliveries (non-control) for all the messages,
   *  3. goal app events for every user with a basis event.
   * Conversions = unique users with the goal event within the window after a
   * basis (click / impression; push opens or deliveries for push/email).
   */
  static async summaries(rows: Array<Pick<MessageRow, 'id' | 'channel' | 'conversion'>>, now: Date = new Date(), days = 7): Promise<Map<string, MessageSummary & { conversionDates: string[] }>> {
    const out = new Map<string, MessageSummary & { conversionDates: string[] }>();
    const dates: string[] = [];
    const start = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z') - (days - 1) * DAY;
    for (let i = 0; i < days; i++) dates.push(new Date(start + i * DAY).toISOString().slice(0, 10));
    for (const r of rows) {
      out.set(r.id, { days, daily: dates.map(() => 0), dailyClicks: dates.map(() => 0), impressions: 0, clicks: 0, uniqueImpressions: 0, uniqueClicks: 0, ctr: null, conversions: 0, conversionRate: null, sent: 0, conversionDates: [] });
    }
    const ids = rows.map((r) => r.id);
    if (!ids.length) return out;
    const supabase = createAdminSupabase();
    const sinceIso = new Date(start).toISOString();
    const dayIdx = new Map(dates.map((d, i) => [d, i]));

    const events: Array<{ message_id: string; user_id: string; type: string; at: string }> = [];
    const deliveries: Array<{ message_id: string; user_id: string; variant_id: string; sent_at: string }> = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      events.push(
        ...(await pageAll<(typeof events)[number]>((a, b) =>
          supabase.from('engage_events').select('message_id, user_id, type, at').in('message_id', part).in('type', ['impression', 'click', 'push_open']).gte('at', sinceIso).range(a, b)
        ))
      );
      if (rows.some((r) => part.includes(r.id) && (r.channel === 'push' || r.channel === 'email'))) {
        deliveries.push(
          ...(await pageAll<(typeof deliveries)[number]>((a, b) =>
            supabase.from('engage_deliveries').select('message_id, user_id, variant_id, sent_at').in('message_id', part).gte('sent_at', sinceIso).range(a, b)
          ))
        );
      }
    }

    const byMsg = new Map(rows.map((r) => [r.id, r]));
    const uniq = new Map<string, { imp: Set<string>; click: Set<string> }>();
    const basis = new Map<string, Map<string, number[]>>(); // message → user → basis times
    const addBasis = (m: string, u: string, at: string) => {
      if (!basis.has(m)) basis.set(m, new Map());
      const mm = basis.get(m)!;
      mm.set(u, [...(mm.get(u) ?? []), Date.parse(at)]);
    };
    for (const e of events) {
      const s = out.get(e.message_id);
      const row = byMsg.get(e.message_id);
      if (!s || !row) continue;
      const u = uniq.get(e.message_id) ?? { imp: new Set(), click: new Set() };
      uniq.set(e.message_id, u);
      const di = dayIdx.get(e.at.slice(0, 10));
      if (e.type === 'impression') {
        s.impressions++;
        u.imp.add(e.user_id);
        if (di !== undefined) s.daily[di]++;
      } else {
        s.clicks++;
        u.click.add(e.user_id);
        if (di !== undefined) s.dailyClicks[di]++;
      }
      const goal = row.conversion;
      if (!goal) continue;
      const isPushOrEmail = row.channel === 'push' || row.channel === 'email';
      if (isPushOrEmail ? goal.basis === 'click' && e.type === 'push_open' : e.type === (goal.basis === 'click' ? 'click' : 'impression')) addBasis(e.message_id, e.user_id, e.at);
    }
    for (const d of deliveries) {
      if (d.variant_id === CONTROL) continue;
      const s = out.get(d.message_id);
      const row = byMsg.get(d.message_id);
      if (!s || !row) continue;
      s.sent++;
      // Push/email have no impressions: the send is the impression for the sparkline.
      const di = dayIdx.get(d.sent_at.slice(0, 10));
      if (di !== undefined) s.daily[di]++;
      if (row.conversion && !(row.channel === 'push' && row.conversion.basis === 'click')) addBasis(d.message_id, d.user_id, d.sent_at);
    }

    // Goal events for every basis user, grouped by event name.
    const goalUsers = new Map<string, Set<string>>();
    for (const [m, users] of basis) {
      const name = byMsg.get(m)!.conversion!.event;
      if (!goalUsers.has(name)) goalUsers.set(name, new Set());
      for (const u of users.keys()) goalUsers.get(name)!.add(u);
    }
    const maxWindow = Math.max(0, ...rows.map((r) => r.conversion?.windowHours ?? 0)) * 3600_000;
    const goalEvents = new Map<string, Map<string, number[]>>(); // name → user → times
    const allUsers = [...new Set([...goalUsers.values()].flatMap((s) => [...s]))];
    const names = [...goalUsers.keys()];
    for (let i = 0; i < allUsers.length && names.length; i += CHUNK) {
      const part = allUsers.slice(i, i + CHUNK);
      const evs = await pageAll<{ user_id: string; name: string; at: string }>((a, b) =>
        supabase
          .from('engage_events')
          .select('user_id, name, at')
          .eq('type', 'app_event')
          .in('name', names)
          .in('user_id', part)
          .gte('at', sinceIso)
          .lte('at', new Date(now.getTime() + maxWindow).toISOString())
          .range(a, b)
      );
      for (const e of evs) {
        if (!goalEvents.has(e.name)) goalEvents.set(e.name, new Map());
        const um = goalEvents.get(e.name)!;
        um.set(e.user_id, [...(um.get(e.user_id) ?? []), Date.parse(e.at)]);
      }
    }
    for (const [m, users] of basis) {
      const row = byMsg.get(m)!;
      const s = out.get(m)!;
      const w = row.conversion!.windowHours * 3600_000;
      const times = goalEvents.get(row.conversion!.event);
      for (const [u, bs] of users) {
        const hit = (times?.get(u) ?? []).filter((t) => bs.some((b) => b <= t && t <= b + w)).sort((a, b) => a - b)[0];
        if (hit !== undefined) {
          s.conversions++;
          s.conversionDates.push(new Date(hit).toISOString().slice(0, 10));
        }
      }
    }
    for (const [id, s] of out) {
      const u = uniq.get(id);
      s.uniqueImpressions = u?.imp.size ?? 0;
      s.uniqueClicks = u?.click.size ?? 0;
      const row = byMsg.get(id)!;
      const reach = row.channel === 'push' || row.channel === 'email' ? s.sent : s.uniqueImpressions;
      s.ctr = ratio(s.uniqueClicks, reach);
      s.conversionRate = row.conversion ? ratio(s.conversions, reach) : null;
    }
    return out;
  }

  /** GET /api/admin/engage/overview */
  static async overview(now: Date = new Date()): Promise<{
    live: EngageMessage[];
    upcoming: EngageMessage[];
    liveByChannel: Record<string, number>;
    last7Days: { impressions: number; clicks: number; conversions: number };
    totals: { impressions: number; clicks: number; conversions: number; pushSent: number; emailSent: number };
    daily: Array<{ date: string; impressions: number; clicks: number; conversions: number }>;
    topMessages: Array<{ messageId: string; id: string; name: string; channel: string; impressions: number; clicks: number; ctr: number | null; conversions: number }>;
  }> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('engage_messages').select('*').is('archived_at', null);
    if (error) throw error;
    const rows = (data ?? []) as MessageRow[];
    const msgs = rows.map((r) => rowToMessage(r, now));
    const live = msgs.filter((m) => m.status === 'live');
    const upcoming = msgs.filter((m) => m.status === 'scheduled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const liveByChannel: Record<string, number> = { content_card: 0, in_app: 0, push: 0, email: 0 };
    for (const m of live) liveByChannel[m.channel] = (liveByChannel[m.channel] ?? 0) + 1;

    // One 14-day summary pass feeds the series, the 7-day totals and the top list.
    const DAYS = 14;
    const sums = await this.summaries(rows, now, DAYS);
    const dates: string[] = [];
    const start = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z') - (DAYS - 1) * DAY;
    for (let i = 0; i < DAYS; i++) dates.push(new Date(start + i * DAY).toISOString().slice(0, 10));
    const daily = dates.map((date) => ({ date, impressions: 0, clicks: 0, conversions: 0 }));
    const idx = new Map(dates.map((d, i) => [d, i]));
    for (const [id, s] of sums) {
      const row = rows.find((r) => r.id === id)!;
      const isSend = row.channel === 'push' || row.channel === 'email';
      s.dailyClicks.forEach((c, i) => (daily[i].clicks += c));
      if (!isSend) s.daily.forEach((c, i) => (daily[i].impressions += c));
      for (const d of s.conversionDates) {
        const i = idx.get(d);
        if (i !== undefined) daily[i].conversions++;
      }
    }
    const last7 = daily.slice(-7);
    const last7Days = {
      impressions: last7.reduce((n, d) => n + d.impressions, 0),
      clicks: last7.reduce((n, d) => n + d.clicks, 0),
      conversions: last7.reduce((n, d) => n + d.conversions, 0),
    };
    // Top messages by clicks over the last 7 days.
    const recent = await this.summaries(rows, now, 7);
    const pushSent = rows.filter((r) => r.channel === 'push').reduce((n, r) => n + (recent.get(r.id)?.sent ?? 0), 0);
    const emailSent = rows.filter((r) => r.channel === 'email').reduce((n, r) => n + (recent.get(r.id)?.sent ?? 0), 0);
    const topMessages = rows
      .map((r) => ({ r, s: recent.get(r.id)! }))
      .filter(({ s }) => s.clicks > 0 || s.impressions > 0)
      .sort((a, b) => b.s.clicks - a.s.clicks || b.s.impressions - a.s.impressions)
      .slice(0, 5)
      .map(({ r, s }) => ({ messageId: r.id, id: r.id, name: r.name, channel: r.channel, impressions: s.impressions, clicks: s.clicks, ctr: s.ctr, conversions: s.conversions }));
    return { live, upcoming, liveByChannel, last7Days, totals: { ...last7Days, pushSent, emailSent }, daily, topMessages };
  }
}
