/**
 * Admin Trials (GET /api/admin/subscriptions/trials[/:userId]): who started a
 * store free trial, where they came from, and what happened. Read-only, service
 * role. Rules live in ./classify.ts (pure); this file only loads rows.
 */
import { CampaignError } from '@/lib/campaigns/http';
import { chunk, db, selectAll } from '@/lib/ads/services/db';
import { canonicalEmail } from '@/lib/validation/email-canonical';

import {
  bestCountry,
  breakdowns,
  countTrials,
  eventAt,
  eventEnvironment,
  eventPeriodType,
  isPaidCharge,
  isStripeNative,
  isTrialStartEvent,
  normCountry,
  planOf,
  rangeStart,
  resolveTrial,
  sortEvents,
  testFlags,
  visible,
  type SubEventRow,
  type TrialCore,
  type TrialProfileRow,
} from './classify';
import type {
  AdEntityRef,
  LocationSignal,
  TrialArm,
  TrialDetail,
  TrialEvent,
  TrialExperiment,
  TrialRow,
  TrialsList,
  TrialsListQuery,
  TrialTestFlag,
} from './types';

const PROFILE_COLS =
  'id, email, email_canonical, display_name, username, created_at, is_admin, metadata, country_code, subscription_tier, subscription_status, subscription_platform, subscription_product_id, subscription_expires_at, subscription_will_renew, trial_started_at, trial_ends_at, trial_converted_at';
const DETAIL_PROFILE_COLS = `${PROFILE_COLS}, last_active_at, onboarding_completed, onboarding_completed_at, onboarding_flow, timezone`;
const EVENT_COLS = 'id, user_id, type, store, environment, event_timestamp, raw';

interface AttributionRow {
  user_id: string;
  channel: string;
  platform: string | null;
  source: string | null;
  campaign_external_id: string | null;
  ad_group_external_id: string | null;
  keyword_external_id: string | null;
  ad_external_id: string | null;
  click_at: string | null;
  country: string | null;
  is_test: boolean | null;
  raw: unknown;
  reported_at: string | null;
}
const ATTRIBUTION_COLS =
  'user_id, channel, platform, source, campaign_external_id, ad_group_external_id, keyword_external_id, ad_external_id, click_at, country, is_test, raw, reported_at';

interface AssignmentRow {
  experiment_key: string;
  user_id: string;
  arm: string;
  assigned_at: string | null;
  first_exposed_at: string | null;
  exposure_surface: string | null;
  platform: string | null;
  app_version: string | null;
  country: string | null;
  reason: string | null;
}
const ASSIGNMENT_COLS = 'experiment_key, user_id, arm, assigned_at, first_exposed_at, exposure_surface, platform, app_version, country, reason';

interface ExperimentInfo {
  name: string | null;
  arms: Map<string, string | null>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function experimentsByKey(): Promise<Map<string, ExperimentInfo>> {
  const rows = await selectAll<{ key: string; name: string | null; arms: unknown }>(() => db().from('experiments').select('key, name, arms').order('key', { ascending: true }));
  const out = new Map<string, ExperimentInfo>();
  for (const r of rows) {
    const arms = new Map<string, string | null>();
    if (Array.isArray(r.arms)) for (const a of r.arms as any[]) if (a && typeof a.key === 'string') arms.set(a.key, typeof a.name === 'string' ? a.name : null);
    out.set(r.key, { name: r.name ?? null, arms });
  }
  return out;
}

async function adminCanonicals(): Promise<Set<string>> {
  const rows = await selectAll<{ id: string; email: string | null; email_canonical: string | null }>(() =>
    db().from('profiles').select('id, email, email_canonical').eq('is_admin', true).order('id', { ascending: true })
  );
  const out = new Set<string>();
  for (const r of rows) {
    const c = r.email_canonical ?? canonicalEmail(r.email);
    if (c) out.add(c);
  }
  return out;
}

/** ad_entities names keyed `<channel>|<level>|<external_id>`. */
async function adNames(refs: { channel: string; level: string; id: string }[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const ids = [...new Set(refs.map((r) => r.id))];
  for (const part of chunk(ids, 150)) {
    const rows = await selectAll<{ channel: string; level: string; external_id: string; name: string | null }>(() =>
      db().from('ad_entities').select('channel, level, external_id, name').in('external_id', part).order('id', { ascending: true })
    );
    for (const r of rows) out.set(`${r.channel}|${r.level}|${r.external_id}`, r.name);
  }
  return out;
}

function latestAssignments(rows: readonly AssignmentRow[]): AssignmentRow[] {
  // One row per (user, experiment) exists; keep stable order by experiment key.
  return [...rows].sort((a, b) => a.experiment_key.localeCompare(b.experiment_key));
}

function armsOf(rows: readonly AssignmentRow[], experiments: Map<string, ExperimentInfo>): TrialArm[] {
  return latestAssignments(rows).map((a) => ({ experimentKey: a.experiment_key, arm: a.arm, armName: experiments.get(a.experiment_key)?.arms.get(a.arm) ?? null }));
}

function latestAssignment(rows: readonly AssignmentRow[]): AssignmentRow | null {
  let best: AssignmentRow | null = null;
  for (const r of rows) if (!best || (r.assigned_at ?? '') > (best.assigned_at ?? '')) best = r;
  return best;
}

function buildRow(input: {
  profile: TrialProfileRow;
  trial: TrialCore;
  attribution: AttributionRow | null;
  assignments: AssignmentRow[];
  experiments: Map<string, ExperimentInfo>;
  campaignNames: Map<string, string | null>;
  flags: TrialTestFlag[];
}): TrialRow {
  const { profile: p, trial: t, attribution: a } = input;
  const country = bestCountry({
    attribution: a?.country,
    store: t.startEvent?.raw?.country_code,
    assignment: latestAssignment(input.assignments)?.country,
    profile: p.country_code,
  });
  const campaignId = a?.campaign_external_id ?? null;
  return {
    userId: p.id,
    email: p.email,
    displayName: p.display_name,
    username: p.username,
    signedUpAt: p.created_at ? new Date(p.created_at).toISOString() : null,
    platform: t.platform,
    productId: t.productId,
    plan: planOf(t.productId),
    environment: t.environment,
    trialStartedAt: t.trialStartedAt,
    trialEndsAt: t.trialEndsAt,
    convertedAt: t.convertedAt,
    status: t.status,
    willRenew: p.subscription_will_renew,
    subscriptionStatus: p.subscription_status,
    country: country?.country ?? null,
    countrySource: country?.source ?? null,
    channel: a?.channel ?? null,
    source: a?.source ?? null,
    campaignId,
    campaignName: campaignId && a ? (input.campaignNames.get(`${a.channel}|campaign|${campaignId}`) ?? null) : null,
    arms: armsOf(input.assignments, input.experiments),
    isTest: input.flags.length > 0,
    testReasons: input.flags.map((f) => f.reason),
  };
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/** Count rows for a filter: exact head count; falls back to the returned rows' length. */
async function countRows(table: string, apply: (q: any) => any): Promise<number> {
  const { count, data, error } = await apply(db().from(table).select('id', { count: 'exact', head: true }));
  if (error) throw new Error(error.message ?? String(error));
  return typeof count === 'number' ? count : Array.isArray(data) ? data.length : 0;
}

function latestIso(values: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const v of values) {
    const t = v ? Date.parse(v) : NaN;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

const toEvent = (e: SubEventRow): TrialEvent => {
  const raw = e.raw ?? {};
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const ms = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v).toISOString() : null);
  return {
    id: e.id,
    type: e.type,
    store: e.store ?? raw.store ?? null,
    environment: e.environment ?? raw.environment ?? null,
    at: eventAt(e),
    periodType: eventPeriodType(e),
    productId: raw.product_id ?? null,
    price: n(raw.price),
    priceInPurchasedCurrency: n(raw.price_in_purchased_currency),
    currency: raw.currency ?? null,
    countryCode: normCountry(raw.country_code),
    offerCode: raw.offer_code ?? null,
    cancelReason: raw.cancel_reason ?? null,
    expirationAt: ms(raw.expiration_at_ms),
    stripeNative: isStripeNative(e),
  };
};

export class TrialsAdminService {
  static async list(query: TrialsListQuery, now: Date = new Date()): Promise<TrialsList> {
    const from = rangeStart(query.range, now)?.toISOString() ?? null;

    // Candidates: profiles with a trial on record, plus users with a TRIAL INITIAL_PURCHASE (either environment).
    const [trialProfiles, initialPurchases] = await Promise.all([
      selectAll<TrialProfileRow>(() => {
        let q = db().from('profiles').select(PROFILE_COLS).not('trial_started_at', 'is', null);
        if (from) q = q.gte('trial_started_at', from);
        return q.order('id', { ascending: true });
      }),
      selectAll<SubEventRow>(() => {
        let q = db().from('subscription_events').select(EVENT_COLS).eq('type', 'INITIAL_PURCHASE');
        if (from) q = q.gte('event_timestamp', from);
        return q.order('id', { ascending: true });
      }),
    ]);
    const profiles = new Map(trialProfiles.map((p) => [p.id, p]));
    const missing = [...new Set(initialPurchases.filter((e) => e.user_id && isTrialStartEvent(e)).map((e) => e.user_id!))].filter((id) => !profiles.has(id));
    for (const part of chunk(missing, 150)) {
      const rows = await selectAll<TrialProfileRow>(() => db().from('profiles').select(PROFILE_COLS).in('id', part).order('id', { ascending: true }));
      for (const p of rows) profiles.set(p.id, p);
    }
    const ids = [...profiles.keys()];

    const events: SubEventRow[] = [];
    const attribution: AttributionRow[] = [];
    const assignments: AssignmentRow[] = [];
    for (const part of chunk(ids, 150)) {
      const [ev, at, as] = await Promise.all([
        selectAll<SubEventRow>(() => db().from('subscription_events').select(EVENT_COLS).in('user_id', part).order('id', { ascending: true })),
        selectAll<AttributionRow>(() => db().from('user_attribution').select(ATTRIBUTION_COLS).in('user_id', part).order('user_id', { ascending: true })),
        selectAll<AssignmentRow>(() =>
          db().from('experiment_assignments').select(ASSIGNMENT_COLS).in('user_id', part).order('user_id', { ascending: true }).order('experiment_key', { ascending: true })
        ),
      ]);
      events.push(...ev);
      attribution.push(...at);
      assignments.push(...as);
    }
    const [experiments, admins] = await Promise.all([experimentsByKey(), adminCanonicals()]);
    const eventsBy = groupBy(events, (e) => e.user_id);
    const attrBy = new Map(attribution.map((a) => [a.user_id, a]));
    const asgBy = groupBy(assignments, (a) => a.user_id);
    const campaignNames = await adNames(
      attribution.filter((a) => a.campaign_external_id).map((a) => ({ channel: a.channel, level: 'campaign', id: a.campaign_external_id! }))
    );

    const fromMs = from ? Date.parse(from) : null;
    const all: TrialRow[] = [];
    for (const p of profiles.values()) {
      const trial = resolveTrial(p, eventsBy.get(p.id) ?? [], now);
      if (!trial) continue;
      if (fromMs !== null && (!trial.trialStartedAt || Date.parse(trial.trialStartedAt) < fromMs)) continue;
      const attr = attrBy.get(p.id) ?? null;
      const flags = testFlags({ profile: p, attributionIsTest: attr?.is_test === true, adminCanonicals: admins });
      all.push(buildRow({ profile: p, trial, attribution: attr, assignments: asgBy.get(p.id) ?? [], experiments, campaignNames, flags }));
    }

    const hidden = { sandbox: 0, test: 0 };
    const rows: TrialRow[] = [];
    for (const r of all) {
      const v = visible(r, query);
      if (v.show) rows.push(r);
      else if (v.hiddenBy === 'sandbox') hidden.sandbox += 1;
      else if (v.hiddenBy === 'test') hidden.test += 1;
    }
    rows.sort((a, b) => (b.trialStartedAt ?? '').localeCompare(a.trialStartedAt ?? '') || a.userId.localeCompare(b.userId));

    return { query, generatedAt: now.toISOString(), summary: countTrials(rows), ...breakdowns(rows), hidden, trials: rows };
  }

  static async detail(userId: string, now: Date = new Date()): Promise<TrialDetail> {
    if (!UUID_RE.test(userId)) throw new CampaignError(400, 'INVALID_USER_ID', 'userId must be a UUID');
    const { data: profileData, error } = await db().from('profiles').select(DETAIL_PROFILE_COLS).eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!profileData) throw new CampaignError(404, 'NOT_FOUND', 'User not found');
    const p = profileData as unknown as TrialProfileRow & {
      last_active_at: string | null;
      onboarding_completed: boolean | null;
      onboarding_completed_at: string | null;
      onboarding_flow: string | null;
      timezone: string | null;
    };

    const [rawEvents, attrRows, asg, experiments, admins] = await Promise.all([
      selectAll<SubEventRow>(() => db().from('subscription_events').select(EVENT_COLS).eq('user_id', userId).order('id', { ascending: true })),
      selectAll<AttributionRow>(() => db().from('user_attribution').select(ATTRIBUTION_COLS).eq('user_id', userId).order('user_id', { ascending: true })),
      selectAll<AssignmentRow>(() => db().from('experiment_assignments').select(ASSIGNMENT_COLS).eq('user_id', userId).order('experiment_key', { ascending: true })),
      experimentsByKey(),
      adminCanonicals(),
    ]);
    const events = sortEvents(rawEvents);
    const trial = resolveTrial(p, events, now);
    if (!trial) throw new CampaignError(404, 'NOT_A_TRIAL', 'This user never started a store free trial');

    const a = attrRows[0] ?? null;
    const refs: { channel: string; level: string; id: string }[] = [];
    if (a?.campaign_external_id) refs.push({ channel: a.channel, level: 'campaign', id: a.campaign_external_id });
    if (a?.ad_group_external_id) refs.push({ channel: a.channel, level: 'ad_group', id: a.ad_group_external_id });
    if (a?.keyword_external_id) refs.push({ channel: a.channel, level: 'keyword', id: a.keyword_external_id });
    if (a?.ad_external_id) refs.push({ channel: a.channel, level: 'ad', id: a.ad_external_id });

    const [names, engagement, devices] = await Promise.all([adNames(refs), TrialsAdminService.engagement(userId, p.last_active_at), TrialsAdminService.devices(userId)]);
    engagement.lastSeenAt = latestIso([
      engagement.lastActiveAt,
      engagement.lastMealAt,
      ...devices.map((d) => d.lastUsedAt),
      ...events.map((e) => eventAt(e)),
    ]);
    const ref = (level: string, id: string | null | undefined): AdEntityRef | null => (id && a ? { id, name: names.get(`${a.channel}|${level}|${id}`) ?? null } : null);

    const flags = testFlags({ profile: p, attributionIsTest: a?.is_test === true, adminCanonicals: admins });
    const row = buildRow({ profile: p, trial, attribution: a, assignments: asg, experiments, campaignNames: names, flags });
    const latest = latestAssignment(asg);

    // Every country / location signal with its source.
    const signals: LocationSignal[] = [];
    const push = (s: LocationSignal) => {
      if (!signals.some((x) => x.source === s.source && x.value === s.value && x.detail === s.detail)) signals.push(s);
    };
    const ac = normCountry(a?.country);
    if (ac) push({ source: 'attribution', value: ac, detail: `Ad attribution (${a!.channel}${a!.source ? `, ${a!.source}` : ''})`, at: a!.reported_at });
    for (const e of events) {
      const c = normCountry(e.raw?.country_code);
      if (c) push({ source: 'store', value: c, detail: `RevenueCat ${e.type} (${e.store ?? e.raw?.store ?? 'store'}, ${eventEnvironment(e)})`, at: eventAt(e) });
    }
    for (const x of asg) {
      const c = normCountry(x.country);
      if (c) push({ source: 'experiment_assignment', value: c, detail: `Experiment ${x.experiment_key} assignment (${x.platform ?? 'app'}${x.app_version ? ` ${x.app_version}` : ''})`, at: x.assigned_at });
    }
    const pc = normCountry(p.country_code);
    if (pc) push({ source: 'profile', value: pc, detail: 'profiles.country_code', at: null });
    if (p.timezone) push({ source: 'timezone', value: p.timezone, detail: 'Device timezone (profiles.timezone)', at: null });

    const charges = events.filter((e) => eventEnvironment(e) === trial.environment && isPaidCharge(e));
    const lastCharge = charges.length ? charges[charges.length - 1]! : null;
    const start = trial.startEvent?.raw ?? {};

    const experimentsOut: TrialExperiment[] = asg.map((x) => ({
      experimentKey: x.experiment_key,
      experimentName: experiments.get(x.experiment_key)?.name ?? null,
      arm: x.arm,
      armName: experiments.get(x.experiment_key)?.arms.get(x.arm) ?? null,
      assignedAt: x.assigned_at,
      firstExposedAt: x.first_exposed_at,
      exposureSurface: x.exposure_surface,
      platform: x.platform,
      appVersion: x.app_version,
      country: normCountry(x.country),
      reason: x.reason,
    }));

    return {
      trial: row,
      profile: {
        userId: p.id,
        email: p.email,
        displayName: p.display_name,
        username: p.username,
        joinedAt: row.signedUpAt,
        lastActiveAt: p.last_active_at,
        onboardingCompleted: p.onboarding_completed,
        onboardingCompletedAt: p.onboarding_completed_at,
        onboardingFlow: p.onboarding_flow,
        timezone: p.timezone,
        isAdmin: p.is_admin === true,
        appPlatform: latest?.platform ?? a?.platform ?? null,
        appVersion: latest?.app_version ?? null,
      },
      location: { best: row.country && row.countrySource ? { country: row.country, source: row.countrySource } : null, signals },
      acquisition: a
        ? {
            channel: a.channel,
            platform: a.platform,
            source: a.source,
            campaign: ref('campaign', a.campaign_external_id),
            adGroup: ref('ad_group', a.ad_group_external_id),
            keyword: ref('keyword', a.keyword_external_id),
            ad: ref('ad', a.ad_external_id),
            clickAt: a.click_at,
            reportedAt: a.reported_at,
            country: normCountry(a.country),
            isTest: a.is_test === true,
            rawKeys: a.raw && typeof a.raw === 'object' && !Array.isArray(a.raw) ? Object.keys(a.raw as object).sort() : [],
          }
        : null,
      subscription: {
        platform: trial.platform,
        store: trial.startEvent?.store ?? null,
        productId: trial.productId,
        plan: planOf(trial.productId),
        environment: trial.environment,
        trialStartedAt: trial.trialStartedAt,
        trialEndsAt: trial.trialEndsAt,
        convertedAt: trial.convertedAt,
        status: trial.status,
        tier: p.subscription_tier,
        subscriptionStatus: p.subscription_status,
        willRenew: p.subscription_will_renew,
        expiresAt: p.subscription_expires_at,
        lastCharge: lastCharge
          ? {
              price: typeof lastCharge.raw?.price === 'number' ? lastCharge.raw.price : null,
              priceInPurchasedCurrency: typeof lastCharge.raw?.price_in_purchased_currency === 'number' ? lastCharge.raw.price_in_purchased_currency : null,
              currency: lastCharge.raw?.currency ?? null,
              at: eventAt(lastCharge),
            }
          : null,
        currency: start.currency ?? null,
        storeCountry: normCountry(start.country_code),
        offerCode: start.offer_code ?? null,
        presentedOfferingId: start.presented_offering_id ?? null,
        originalTransactionId: start.original_transaction_id ?? null,
      },
      events: events.map(toEvent),
      experiments: experimentsOut,
      engagement,
      devices,
      flags: {
        isTest: flags.length > 0,
        test: flags,
        environment: trial.environment,
        sandboxEvents: events.filter((e) => eventEnvironment(e) === 'sandbox').length,
        productionEvents: events.filter((e) => eventEnvironment(e) === 'production').length,
      },
    };
  }

  private static async engagement(userId: string, lastActiveAt: string | null): Promise<TrialDetail['engagement']> {
    const [foodLogEntries, mealsLogged, firstMeal, lastMeal, checkIns, fitzyConversations, fitzyMessages, circlesJoined] = await Promise.all([
      countRows('food_log_entries', (q) => q.eq('user_id', userId).is('deleted_at', null)),
      countRows('food_log_entries', (q) => q.eq('user_id', userId).eq('entry_type', 'food').is('deleted_at', null)),
      db().from('food_log_entries').select('logged_at').eq('user_id', userId).eq('entry_type', 'food').is('deleted_at', null).order('logged_at', { ascending: true }).limit(1),
      db().from('food_log_entries').select('logged_at').eq('user_id', userId).eq('entry_type', 'food').is('deleted_at', null).order('logged_at', { ascending: false }).limit(1),
      countRows('daily_tracking', (q) => q.eq('user_id', userId)),
      countRows('fitzy_conversations', (q) => q.eq('user_id', userId)),
      countRows('fitzy_messages', (q) => q.eq('user_id', userId).eq('role', 'user')),
      countRows('fitcircle_members', (q) => q.eq('user_id', userId)),
    ]);
    const first = (r: any) => ((r?.data as { logged_at: string | null }[] | null)?.[0]?.logged_at ?? null);
    return {
      mealsLogged,
      foodLogEntries,
      firstMealAt: first(firstMeal),
      lastMealAt: first(lastMeal),
      checkIns,
      fitzyConversations,
      fitzyMessages,
      circlesJoined,
      lastActiveAt,
      lastSeenAt: lastActiveAt,
    };
  }

  private static async devices(userId: string): Promise<TrialDetail['devices']> {
    const { data, error } = await db()
      .from('push_tokens')
      .select('platform, device_name, is_active, last_used_at')
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false })
      .limit(10);
    if (error) return [];
    return ((data ?? []) as any[]).map((d) => ({ platform: d.platform ?? null, deviceName: d.device_name ?? null, isActive: d.is_active ?? null, lastUsedAt: d.last_used_at ?? null }));
  }
}
