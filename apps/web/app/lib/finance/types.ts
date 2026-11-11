/** FitCircle Finance report shapes (GET /api/admin/finance/ai-costs, /api/admin/finance/pnl). */
import type { Plan, RecurringSnapshot, RevenueStore } from './recurring';

export type { Plan, RecurringSnapshot, RevenueStore } from './recurring';

export type SpendClass = 'production' | 'testUsers' | 'evalDev' | 'unattributed';
export type Segment = 'paying' | 'trial' | 'free';
export type PnlGrain = 'day' | 'week' | 'month';

/** One ai_cost_daily row (gateway Custom Reporting, UTC day). */
export interface GatewayDailyRow {
  day: string;
  dimension: 'total' | 'user' | 'tag' | 'model';
  key: string;
  totalCost: number;
  marketCost: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  requestCount: number;
}

/** One ai_usage_events row (per-call ledger). */
export interface LedgerRow {
  createdAt: string;
  userId: string | null;
  feature: string;
  model: string;
  environment: string;
  costUsd: number | null;
  ok: boolean;
}

/** A user the report needs to name / classify. */
export interface FinanceUser {
  userId: string;
  email: string | null;
  displayName: string | null;
  testReason: string | null;
  createdAt: string | null;
}

/** One signal that a user was active (home_feed_decisions row or app_opens first open). */
export interface ActivityRow {
  userId: string;
  at: string;
  platform: string | null;
}

export interface AiCostsReport {
  range: { start: string; end: string; timeZone: string };
  generatedAt: string;
  lastSyncAt: string | null;
  creditsBalance: number | null;
  ledgerSince: string | null;
  includeTest: boolean;
  totals: {
    gatewayTotal: number;
    fitcircleProduction: number;
    testUsers: number;
    evalDev: number;
    unattributed: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
  };
  perUser: {
    activeUsers: number;
    userDays: number;
    aiUsers: number;
    costPerDauDay: number | null;
    costPerAiUser: number | null;
    segments: Array<{
      segment: Segment;
      users: number;
      aiUsers: number;
      userDays: number;
      cost: number;
      costPerUser: number | null;
      costPerUserDay: number | null;
      revenueNet: number;
      /** revenueNet split by plan (sums to revenueNet). */
      revenueNetByPlan: Record<Plan, number>;
      costToRevenue: number | null;
    }>;
  };
  byDay: Array<{
    day: string;
    gatewayTotal: number;
    production: number;
    testUsers: number;
    evalDev: number;
    unattributed: number;
    /** Σ ledger cost that UTC day; null when the ledger has no rows that day. */
    ledger: number | null;
    /** ledger − gatewayTotal (null without ledger rows). */
    diff: number | null;
    diffPct: number | null;
    /** |diffPct| > 2 %. */
    flagged: boolean;
    /** Where the class split came from. */
    source: 'ledger' | 'gateway';
    dau: number;
    costPerDau: number | null;
  }>;
  byFeature: Array<{ feature: string; cost: number; requests: number; users: number | null; costPerRequest: number | null }>;
  byModel: Array<{
    model: string;
    cost: number;
    marketCost: number | null;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
  }>;
  users: Array<{
    userId: string;
    email: string | null;
    displayName: string | null;
    segment: Segment;
    isTest: boolean;
    platform: string | null;
    cost: number;
    requests: number;
    topFeature: string | null;
    firstAt: string | null;
    lastAt: string | null;
    activeDays: number;
  }>;
  definitions: Record<string, string>;
  notes: string[];
}

export interface PnlLines {
  start: string;
  end: string;
  label: string;
  revenue: {
    subscriptionGross: number;
    storeFeesAndTax: number;
    subscriptionNet: number;
    /** Cash collected by plan (sums to subscriptionGross / subscriptionNet). */
    byPlan: Array<{ plan: Plan; gross: number; net: number; charges: number }>;
    /** Cash collected by store (app_store | play_store | stripe | other). */
    byStore: Array<{ store: RevenueStore; gross: number; net: number; charges: number }>;
    /** AdMob estimated earnings; null when AdMob is not connected. */
    adRevenue: number | null;
    totalNet: number;
  };
  costs: {
    ua: { total: number; byChannel: { apple_ads: number; google_ads: number; meta: number } };
    ai: { production: number; testUsers: number; evalDev: number; unattributed: number; total: number };
    total: number;
  };
  net: number;
  margin: number | null;
  cumulativeNet: number;
  kpis: { newUsers: number; payers: number; dauAvg: number | null; cac: number | null; aiCostPerDau: number | null };
  /** Recurring run-rate as of the end of the period (capped at now). */
  recurring: RecurringSnapshot;
}

export interface PnlReport {
  range: { start: string; end: string; timeZone: string };
  grain: PnlGrain;
  generatedAt: string;
  periods: PnlLines[];
  totals: PnlLines;
  /** Recurring run-rate as of the range end (capped at now); same as totals.recurring. */
  recurring: RecurringSnapshot;
  definitions: Record<string, string>;
  notes: string[];
}
