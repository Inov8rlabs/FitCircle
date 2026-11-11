/**
 * AI cost report (pure). Inputs are loaded by FinanceReportService; nothing here touches the DB.
 *
 * Sources and how they combine (docs: FINANCE_SPEC "Accuracy rules"):
 *  - Gateway report rows (ai_cost_daily, UTC days, ACCOUNT-WIDE) are the billed truth for totals,
 *    per-user cost (gateway `user`), per-model and per-feature (tags) cost.
 *  - The ledger (ai_usage_events) is per-call attribution. On a UTC day with ledger rows, the
 *    spend classes come from the ledger (environment + user), and whatever the gateway billed
 *    beyond the ledger is "unattributed". On days without ledger rows (all history before the
 *    ledger existed) the classes come from the gateway `user` dimension: untagged ('' user) is
 *    unattributed — never guessed.
 */
import { eachDay, ymdInTz } from '../ads/dates';
import { isUuid } from '../ai/usage';

import { PLANS } from './recurring';
import type { ActivityRow, AiCostsReport, FinanceUser, GatewayDailyRow, LedgerRow, Plan, Segment, SpendClass } from './types';

/** Known evaluation / fixture user ids (food-AI bake-off, eval harness). */
export const EVAL_USER_IDS: readonly string[] = ['00000000-0000-0000-0000-0000000000e7', '00000000-0000-4000-8000-000000000000'];

export const LEGACY_SOURCE_FEATURE: Record<string, string> = {
  'source:photo': 'food_photo',
  'source:text': 'food_text',
  'source:voice': 'food_voice',
  'source:item': 'food_item',
};

export const UNTAGGED_FEATURE = 'untagged';
export const OTHER_TAGGED_FEATURE = 'other_tagged';
/** Ledger days: billed gateway spend not covered by ai_usage_events (other projects / keys, failed ledger writes). */
export const UNTRACKED_FEATURE = 'untracked';
const RECONCILE_FLAG_PCT = 2;

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const div = (n: number, d: number): number | null => (d > 0 && Number.isFinite(n) ? n / d : null);
const r6 = (v: number | null) => (v === null ? null : round6(v));

export type KeyClass = 'unattributed' | 'evalDev' | 'system' | 'testUsers' | 'production';

export function isEvalUser(id: string | null | undefined, extra: readonly string[] = []): boolean {
  return !!id && (EVAL_USER_IDS.includes(id) || extra.includes(id));
}

/**
 * What one gateway `user` key is: '' = untagged → unattributed; eval fixture ids and named probes
 * (any non-uuid key that is not `system:<job>`) → eval/dev; `system:<job>` → system work; a
 * profile id → test user or production (a uuid we cannot find, e.g. a deleted account, counts as
 * production: it was a real request we paid for).
 */
export function classifyGatewayKey(key: string, users: Map<string, FinanceUser>, evalIds: readonly string[] = []): KeyClass {
  if (!key) return 'unattributed';
  if (isEvalUser(key, evalIds)) return 'evalDev';
  if (key.startsWith('system:')) return 'system';
  if (!isUuid(key)) return 'evalDev';
  return users.get(key)?.testReason ? 'testUsers' : 'production';
}

export type DayClasses = Record<SpendClass, number>;
const zeroClasses = (): DayClasses => ({ production: 0, testUsers: 0, evalDev: 0, unattributed: 0 });

/**
 * Class split of one UTC day from gateway rows. Spend tagged with a non-production `env:` tag is
 * eval/dev; it is taken out of system work first (crons / probes run locally), the bucket it is
 * most likely in. Any gateway total not covered by user rows is unattributed.
 */
export function gatewayDayClasses(dayRows: GatewayDailyRow[], users: Map<string, FinanceUser>, evalIds: readonly string[] = []): DayClasses {
  const out = zeroClasses();
  let system = 0;
  let userSum = 0;
  for (const r of dayRows) {
    if (r.dimension !== 'user') continue;
    userSum += r.totalCost;
    const c = classifyGatewayKey(r.key, users, evalIds);
    if (c === 'system') system += r.totalCost;
    else out[c] += r.totalCost;
  }
  const devTagged = dayRows.filter((r) => r.dimension === 'tag' && r.key.startsWith('env:') && r.key !== 'env:production').reduce((s, r) => s + r.totalCost, 0);
  const moved = Math.min(devTagged, system);
  out.evalDev += moved;
  out.production += system - moved;
  const total = dayTotal(dayRows);
  if (total > userSum) out.unattributed += total - userSum;
  return out;
}

/** Class split of one UTC day from ledger rows; the gateway's excess is unattributed. */
export function ledgerDayClasses(rows: LedgerRow[], gatewayTotal: number, users: Map<string, FinanceUser>, evalIds: readonly string[] = []): DayClasses & { ledger: number } {
  const out = zeroClasses();
  let ledger = 0;
  for (const r of rows) {
    const cost = r.costUsd ?? 0;
    ledger += cost;
    if (r.environment !== 'production' || isEvalUser(r.userId, evalIds)) out.evalDev += cost;
    else if (r.userId && users.get(r.userId)?.testReason) out.testUsers += cost;
    else out.production += cost;
  }
  out.unattributed = Math.max(0, gatewayTotal - ledger);
  return { ...out, ledger };
}

/** The day's billed total: the `total` row, else the sum of user rows. */
export function dayTotal(dayRows: GatewayDailyRow[]): number {
  const t = dayRows.find((r) => r.dimension === 'total');
  if (t) return t.totalCost;
  return dayRows.filter((r) => r.dimension === 'user').reduce((s, r) => s + r.totalCost, 0);
}

/** Distinct active users per day (bucketed in `tz`), test users removed unless includeTest. */
export function activeUsersByDay(activity: ActivityRow[], tz: string, isIncluded: (userId: string) => boolean): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const a of activity) {
    if (!isIncluded(a.userId)) continue;
    const day = ymdInTz(a.at, tz);
    let set = out.get(day);
    if (!set) out.set(day, (set = new Set()));
    set.add(a.userId);
  }
  return out;
}

export interface AiCostsInput {
  range: { start: string; end: string; timeZone: string };
  includeTest: boolean;
  now: Date;
  gatewayRows: GatewayDailyRow[];
  ledger: LedgerRow[];
  users: Map<string, FinanceUser>;
  activity: ActivityRow[];
  /** Segment as of the range end, per user (missing = free). */
  segments: Map<string, Segment>;
  /** Net subscription revenue booked in the range (report time zone), per user and plan. */
  revenueByUser: Map<string, Partial<Record<Plan, number>>>;
  lastSyncAt: string | null;
  creditsBalance: number | null;
  /** First ledger row ever (UTC date), null when the ledger is empty / missing. */
  ledgerSince: string | null;
  /** Loader notes (missing tables, overrides). */
  notes?: string[];
  evalUserIds?: readonly string[];
}

export const AI_COST_DEFINITIONS: Record<string, string> = {
  gatewayTotal: 'Everything the Vercel AI Gateway billed in the range (Custom Reporting total_cost: inference + gateway fees such as reporting-tag writes). ACCOUNT-WIDE: every project, API key and local/eval run on the Vercel team, not only the FitCircle app.',
  fitcircleProduction: 'Spend serving real users from production: ledger rows with environment=production for non-test users and system jobs; before the ledger, gateway spend tagged with a real user id.',
  testUsers: 'Production spend on internal / review / QA / test-lab / Play-tester accounts (lib/ads/test-users.ts).',
  evalDev: 'Evaluation and development spend: environment ≠ production (local scripts, previews, model bake-offs) and eval fixture users (…00e7, 00000000-0000-4000-8000-000000000000).',
  unattributed: 'Billed spend we cannot attribute: before the per-call ledger, calls without a gateway user (all Fitzy, coach, body-comp, grounding and embedding calls); with the ledger, gateway spend above it (other projects / keys on the account, failed ledger writes). Never estimated into other classes.',
  ledger: 'Σ per-call cost from ai_usage_events (providerMetadata.gateway.gatewayCost). Reconciliation: diff = ledger − gateway; |diff| > 2 % is flagged.',
  dau: 'Distinct signed-in users who opened the app that UTC day (home_feed_decisions or app_opens), test users excluded unless includeTest. UTC so it lines up with gateway days.',
  costPerDauDay: 'Production AI spend ÷ Σ daily active users over the range (cost per active user-day).',
  costPerAiUser: 'User-attributed AI spend ÷ users with at least one attributed model call in the range.',
  segment: 'As of the range end, from RevenueCat production events: paying = at least one paid, unrefunded charge; trial = started a free trial and never paid; free = everyone else (complimentary Pro grants count as free).',
  revenueNet: 'Cash collected: net subscription revenue (after store commission and tax, refunds subtracted) booked in the range by users in the segment (report time zone). revenueNetByPlan splits it into monthly, annual paid upfront, annual paid in monthly installments, lifetime (one-time) and other.',
  costToRevenue: 'Segment AI cost ÷ segment net revenue.',
  byFeature: 'Cost by feature (all spend classes). Days with a per-call ledger: from the ledger, with billed gateway spend above it shown as "untracked" (other projects / keys on the account). Earlier days: the gateway `feature:` tag, food parses by their legacy `source:` tag, everything else "untagged". Users per feature come from the ledger.',
  byModel: 'Gateway cost by model, all spend classes. marketCost = inference at list price (no gateway fees).',
  userCost: 'Gateway cost billed with that user id (every class, all features); requests likewise. topFeature, firstAt and lastAt come from the ledger when it has rows, else first/last gateway day.',
};

export function buildAiCostsReport(input: AiCostsInput): AiCostsReport {
  const { range, users, includeTest } = input;
  const evalIds = input.evalUserIds ?? [];
  const days = eachDay(range.start, range.end);
  const inRange = (d: string) => d >= range.start && d <= range.end;

  const rowsByDay = new Map<string, GatewayDailyRow[]>();
  for (const r of input.gatewayRows) {
    if (!inRange(r.day)) continue;
    const list = rowsByDay.get(r.day) ?? [];
    list.push(r);
    rowsByDay.set(r.day, list);
  }
  const ledgerByDay = new Map<string, LedgerRow[]>();
  for (const r of input.ledger) {
    const day = ymdInTz(r.createdAt, 'UTC');
    if (!inRange(day)) continue;
    const list = ledgerByDay.get(day) ?? [];
    list.push(r);
    ledgerByDay.set(day, list);
  }

  const isTest = (id: string) => !!users.get(id)?.testReason;
  const included = (id: string) => !isEvalUser(id, evalIds) && (includeTest || !isTest(id));
  const dauSets = activeUsersByDay(input.activity, 'UTC', included);

  // ---- per day --------------------------------------------------------------
  const byDay: AiCostsReport['byDay'] = days.map((day) => {
    const dayRows = rowsByDay.get(day) ?? [];
    const gatewayTotal = dayTotal(dayRows);
    const lrows = ledgerByDay.get(day) ?? [];
    let cls: DayClasses;
    let ledger: number | null = null;
    let source: 'ledger' | 'gateway' = 'gateway';
    if (lrows.length) {
      const l = ledgerDayClasses(lrows, gatewayTotal, users, evalIds);
      ledger = l.ledger;
      cls = l;
      source = 'ledger';
    } else {
      cls = gatewayDayClasses(dayRows, users, evalIds);
    }
    const diff = ledger === null ? null : ledger - gatewayTotal;
    const diffPct = diff === null ? null : gatewayTotal > 0 ? (diff / gatewayTotal) * 100 : ledger! > 0 ? 100 : 0;
    const dau = dauSets.get(day)?.size ?? 0;
    const prodForDau = cls.production + (includeTest ? cls.testUsers : 0);
    return {
      day,
      gatewayTotal: round6(gatewayTotal),
      production: round6(cls.production),
      testUsers: round6(cls.testUsers),
      evalDev: round6(cls.evalDev),
      unattributed: round6(cls.unattributed),
      ledger: r6(ledger),
      diff: r6(diff),
      diffPct: diffPct === null ? null : Math.round(diffPct * 100) / 100,
      flagged: diffPct !== null && Math.abs(diffPct) > RECONCILE_FLAG_PCT,
      source,
      dau,
      costPerDau: r6(div(prodForDau, dau)),
    };
  });

  const sum = (f: (d: (typeof byDay)[number]) => number) => byDay.reduce((s, d) => s + f(d), 0);
  const totalRows = [...rowsByDay.values()].flat().filter((r) => r.dimension === 'total');
  const totals: AiCostsReport['totals'] = {
    gatewayTotal: round6(sum((d) => d.gatewayTotal)),
    fitcircleProduction: round6(sum((d) => d.production)),
    testUsers: round6(sum((d) => d.testUsers)),
    evalDev: round6(sum((d) => d.evalDev)),
    unattributed: round6(sum((d) => d.unattributed)),
    requests: totalRows.reduce((s, r) => s + r.requestCount, 0),
    inputTokens: totalRows.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: totalRows.reduce((s, r) => s + r.outputTokens, 0),
  };

  // ---- per user (gateway `user` dimension) ------------------------------------
  type Acc = { cost: number; requests: number; firstDay: string; lastDay: string };
  const perUserCost = new Map<string, Acc>();
  for (const [day, rows] of rowsByDay) {
    for (const r of rows) {
      if (r.dimension !== 'user' || !isUuid(r.key) || isEvalUser(r.key, evalIds)) continue;
      const a = perUserCost.get(r.key) ?? { cost: 0, requests: 0, firstDay: day, lastDay: day };
      a.cost += r.totalCost;
      a.requests += r.requestCount;
      if (day < a.firstDay) a.firstDay = day;
      if (day > a.lastDay) a.lastDay = day;
      perUserCost.set(r.key, a);
    }
  }
  const activeDays = new Map<string, number>();
  const anyActiveDays = new Map<string, number>();
  for (const [day, set] of activeUsersByDay(input.activity, 'UTC', () => true)) {
    if (!inRange(day)) continue;
    for (const id of set) anyActiveDays.set(id, (anyActiveDays.get(id) ?? 0) + 1);
  }
  const platformCounts = new Map<string, Map<string, number>>();
  for (const [day, set] of dauSets) {
    if (!inRange(day)) continue;
    for (const id of set) activeDays.set(id, (activeDays.get(id) ?? 0) + 1);
  }
  for (const a of input.activity) {
    if (!a.platform) continue;
    const m = platformCounts.get(a.userId) ?? new Map<string, number>();
    m.set(a.platform, (m.get(a.platform) ?? 0) + 1);
    platformCounts.set(a.userId, m);
  }
  const topPlatform = (id: string) => {
    const m = platformCounts.get(id);
    if (!m) return null;
    return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  };
  const segmentOf = (id: string): Segment => input.segments.get(id) ?? 'free';

  const userDays = byDay.reduce((s, d) => s + d.dau, 0);
  const activeIds = new Set<string>();
  for (const [day, set] of dauSets) if (inRange(day)) for (const id of set) activeIds.add(id);
  const aiIds = new Set([...perUserCost.entries()].filter(([id, a]) => included(id) && a.requests > 0).map(([id]) => id));
  const attributedCost = [...aiIds].reduce((s, id) => s + (perUserCost.get(id)?.cost ?? 0), 0);
  const prodForDau = totals.fitcircleProduction + (includeTest ? totals.testUsers : 0);

  const SEGMENTS: Segment[] = ['paying', 'trial', 'free'];
  const segments = SEGMENTS.map((segment) => {
    const revenueIds = [...input.revenueByUser.keys()].filter((id) => included(id) && segmentOf(id) === segment);
    const ids = new Set([...activeIds, ...aiIds, ...revenueIds].filter((id) => segmentOf(id) === segment));
    const segAi = [...ids].filter((id) => aiIds.has(id));
    const cost = segAi.reduce((s, id) => s + (perUserCost.get(id)?.cost ?? 0), 0);
    const days = [...ids].reduce((s, id) => s + (activeDays.get(id) ?? 0), 0);
    const revenueNetByPlan = Object.fromEntries(PLANS.map((p) => [p, 0])) as Record<Plan, number>;
    for (const id of revenueIds) for (const [p, v] of Object.entries(input.revenueByUser.get(id) ?? {})) revenueNetByPlan[p as Plan] += v ?? 0;
    for (const p of PLANS) revenueNetByPlan[p] = Math.round(revenueNetByPlan[p] * 100) / 100;
    const revenueNet = Math.round(PLANS.reduce((s, p) => s + revenueNetByPlan[p], 0) * 100) / 100;
    return {
      segment,
      users: ids.size,
      aiUsers: segAi.length,
      userDays: days,
      cost: round6(cost),
      costPerUser: r6(div(cost, ids.size)),
      costPerUserDay: r6(div(cost, days)),
      revenueNet,
      revenueNetByPlan,
      costToRevenue: revenueNet > 0 ? round6(cost / revenueNet) : null,
    };
  });

  // ---- ledger per user / feature ----------------------------------------------
  const ledgerInRange = [...ledgerByDay.values()].flat();
  const ledgerUser = new Map<string, { first: string; last: string; features: Map<string, number> }>();
  const featureUsers = new Map<string, Set<string>>();
  for (const r of ledgerInRange) {
    if (r.userId) {
      const u = ledgerUser.get(r.userId) ?? { first: r.createdAt, last: r.createdAt, features: new Map<string, number>() };
      if (r.createdAt < u.first) u.first = r.createdAt;
      if (r.createdAt > u.last) u.last = r.createdAt;
      // Rank features by cost (a row without a cost still counts, barely).
      u.features.set(r.feature, (u.features.get(r.feature) ?? 0) + (r.costUsd ?? 0) + 1e-9);
      ledgerUser.set(r.userId, u);
      const fu = featureUsers.get(r.feature) ?? new Set<string>();
      fu.add(r.userId);
      featureUsers.set(r.feature, fu);
    }
  }

  const usersOut: AiCostsReport['users'] = [...perUserCost.entries()]
    .map(([userId, a]) => {
      const info = users.get(userId);
      const l = ledgerUser.get(userId);
      const topFeature = l ? [...l.features.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null : null;
      return {
        userId,
        email: info?.email ?? null,
        displayName: info?.displayName ?? null,
        segment: segmentOf(userId),
        isTest: !!info?.testReason,
        platform: topPlatform(userId),
        cost: round6(a.cost),
        requests: a.requests,
        topFeature,
        firstAt: l?.first ?? a.firstDay,
        lastAt: l?.last ?? a.lastDay,
        activeDays: anyActiveDays.get(userId) ?? 0,
      };
    })
    .sort((x, y) => y.cost - x.cost || x.userId.localeCompare(y.userId))
    .slice(0, 200);

  // ---- by feature (gateway tags) ----------------------------------------------
  const feat = new Map<string, { cost: number; requests: number }>();
  const addFeat = (k: string, cost: number, requests: number) => {
    const f = feat.get(k) ?? { cost: 0, requests: 0 };
    f.cost += cost;
    f.requests += requests;
    feat.set(k, f);
  };
  for (const day of days) {
    const rows = rowsByDay.get(day) ?? [];
    const lrows = ledgerByDay.get(day) ?? [];
    if (lrows.length) {
      // Ledger days: features come from the per-call ledger (gateway reporting tags are off by
      // default — they are billed per write). Billed gateway spend above the ledger is "untracked"
      // (other projects / keys on the account, or calls whose ledger write failed).
      let ledgerCost = 0;
      for (const r of lrows) {
        const c = r.costUsd ?? 0;
        addFeat(r.feature, c, 1);
        ledgerCost += c;
      }
      const rest = dayTotal(rows) - ledgerCost;
      if (rest > 1e-6) addFeat(UNTRACKED_FEATURE, rest, 0);
      continue;
    }
    if (!rows.length) continue;
    const tags = rows.filter((r) => r.dimension === 'tag');
    // feature:<name> tags (one per call since tagging shipped). Food parses also keep their legacy
    // source:<x> tag, so source:<x> − feature:food_<x> is the part of the day before tagging.
    let covered = 0;
    let coveredReq = 0;
    const featureCost = new Map<string, GatewayDailyRow>();
    for (const r of tags) {
      if (!r.key.startsWith('feature:')) continue;
      const f = r.key.slice('feature:'.length);
      featureCost.set(f, r);
      addFeat(f, r.totalCost, r.requestCount);
      covered += r.totalCost;
      coveredReq += r.requestCount;
    }
    for (const r of tags) {
      const f = LEGACY_SOURCE_FEATURE[r.key];
      if (!f) continue;
      const tagged = featureCost.get(f);
      const cost = r.totalCost - (tagged?.totalCost ?? 0);
      const req = r.requestCount - (tagged?.requestCount ?? 0);
      if (cost <= 1e-9 && req <= 0) continue;
      addFeat(f, Math.max(0, cost), Math.max(0, req));
      covered += Math.max(0, cost);
      coveredReq += Math.max(0, req);
    }
    const untagged = tags.find((r) => r.key === '');
    if (untagged) {
      addFeat(UNTAGGED_FEATURE, untagged.totalCost, untagged.requestCount);
      covered += untagged.totalCost;
      coveredReq += untagged.requestCount;
    }
    if (!tags.length) {
      // No tag rows synced for the day: the whole day is unattributed by feature.
      const t = rows.find((r) => r.dimension === 'total');
      addFeat(UNTAGGED_FEATURE, dayTotal(rows), t?.requestCount ?? 0);
      continue;
    }
    const rest = dayTotal(rows) - covered;
    if (rest > 1e-6) {
      const t = rows.find((r) => r.dimension === 'total');
      addFeat(OTHER_TAGGED_FEATURE, rest, Math.max(0, (t?.requestCount ?? 0) - coveredReq));
    }
  }
  const byFeature = [...feat.entries()]
    .map(([feature, f]) => ({
      feature,
      cost: round6(f.cost),
      requests: f.requests,
      users: featureUsers.has(feature) ? featureUsers.get(feature)!.size : null,
      costPerRequest: r6(div(f.cost, f.requests)),
    }))
    .sort((a, b) => b.cost - a.cost || a.feature.localeCompare(b.feature));

  // ---- by model ---------------------------------------------------------------
  const models = new Map<string, AiCostsReport['byModel'][number]>();
  for (const r of [...rowsByDay.values()].flat()) {
    if (r.dimension !== 'model') continue;
    const m = models.get(r.key) ?? { model: r.key || '(unknown)', cost: 0, marketCost: 0, requests: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
    m.cost += r.totalCost;
    m.marketCost = m.marketCost === null || r.marketCost === null ? null : m.marketCost + r.marketCost;
    m.requests += r.requestCount;
    m.inputTokens += r.inputTokens;
    m.outputTokens += r.outputTokens;
    m.cachedInputTokens += r.cachedInputTokens;
    m.reasoningTokens += r.reasoningTokens;
    models.set(r.key, m);
  }
  const byModel = [...models.values()].map((m) => ({ ...m, cost: round6(m.cost), marketCost: r6(m.marketCost) })).sort((a, b) => b.cost - a.cost);

  // ---- notes ------------------------------------------------------------------
  const notes: string[] = [...(input.notes ?? [])];
  notes.push('The gateway report is account-wide (the whole Vercel team: every project, API key and local/eval run), not just the FitCircle app. Spend classes separate FitCircle production from the rest.');
  notes.push(`AI cost days are UTC (the gateway's report days; verified 2026-11-10). Revenue in segments uses ${range.timeZone} days. DAU here is bucketed in UTC to match.`);
  const daysWithoutData = days.filter((d) => !(rowsByDay.get(d) ?? []).length);
  if (daysWithoutData.length) notes.push(`${daysWithoutData.length} day(s) in the range have no synced gateway data yet (${daysWithoutData.slice(0, 3).join(', ')}${daysWithoutData.length > 3 ? ', …' : ''}); the sync runs daily for the last 3 UTC days.`);
  if (!input.ledgerSince) notes.push('No per-call ledger rows yet (ai_usage_events). Spend classes come from the gateway user dimension: before tagging shipped only food parses carried a user, so Fitzy, coach, body-comp, grounding and embedding spend is "unattributed".');
  else if (input.ledgerSince > range.start) notes.push(`The per-call ledger starts ${input.ledgerSince}; earlier days use the gateway user dimension (untagged spend = unattributed).`);
  const flagged = byDay.filter((d) => d.flagged);
  if (flagged.length) notes.push(`Ledger vs gateway differs by more than ${RECONCILE_FLAG_PCT}% on ${flagged.length} day(s): ${flagged.slice(0, 5).map((d) => `${d.day} (${d.diffPct}%)`).join(', ')}. A partial day (sync not yet run) or failed ledger writes cause this.`);
  if (totals.evalDev > totals.fitcircleProduction && totals.evalDev > 0) notes.push('Eval/dev spend exceeds production spend in this range (model bake-offs and eval runs).');
  notes.push('Excluded: Vercel infrastructure, Supabase and other non-model costs. Reporting-tag writes ($0.075 per 1,000) are included in gateway cost.');

  return {
    range,
    generatedAt: input.now.toISOString(),
    lastSyncAt: input.lastSyncAt,
    creditsBalance: input.creditsBalance,
    ledgerSince: input.ledgerSince,
    includeTest,
    totals,
    perUser: {
      activeUsers: activeIds.size,
      userDays,
      aiUsers: aiIds.size,
      costPerDauDay: r6(div(prodForDau, userDays)),
      costPerAiUser: r6(div(attributedCost, aiIds.size)),
      segments,
    },
    byDay,
    byFeature,
    byModel,
    users: usersOut,
    definitions: AI_COST_DEFINITIONS,
    notes,
  };
}
