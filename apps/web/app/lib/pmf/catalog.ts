/**
 * The KPIs the PMF scorecard tracks, with definitions, thresholds and where each threshold comes from.
 *
 * Sources (exact numbers, no invention):
 *  - pmf_doc     docs/PMF-METRICS.md (Oct 2025): retention table, DAU/MAU, K-factor, organic share, NPS, CSAT,
 *                churn, LTV, CAC, LTV/CAC, ARPU, paid conversion (benchmark table), activation, profile completion,
 *                session metrics and the PMF score formula.
 *  - growth_plan docs/GROWTH_STRATEGY_AND_OPERATING_PLAN.md (2026-10-31) §4 "Gates": cost per activated user ≤ $25,
 *                D7 ≥ 20% per channel, trial start ≥ 15% of activated, invite rate ≥ 25% (fail < 10%),
 *                invite → join ≥ 20%, K ≥ 0.2; §5 north star (weekly active users with ≥ 1 active buddy).
 *  - benchmark   not in our docs; a common rule of thumb, labelled as such in the UI.
 *
 * Threshold rule: `target` = the doc's nearest-term target (e.g. "Month 3 target", "current target", a growth-plan
 * gate), `minimum` = the doc's minimum viable value / fail line, `pmfThreshold` = the doc's PMF threshold when it is
 * further out, `best` = best-in-class.
 */
import type { KpiGroup, KpiThreshold, KpiUnit } from './types';

export interface KpiDef {
  id: string;
  name: string;
  group: KpiGroup;
  unit: KpiUnit;
  definition: string;
  threshold: KpiThreshold | null;
  /** Days a sign-up needs before it counts (cohort KPIs). Null = activity KPI (window = calendar days). */
  maturityDays: number | null;
  /** What to do when this KPI is off (growth-plan references). */
  action: string;
  /** Set for KPIs we cannot compute from data we collect. */
  notMeasured?: { reason: string; needed: string };
  pmfComponent?: string;
  notes?: string[];
}

const PMF = 'PMF-METRICS.md';
const PLAN = 'Growth plan §4 gates';

const t = (x: Omit<KpiThreshold, 'minimum' | 'best' | 'pmfThreshold'> & Partial<Pick<KpiThreshold, 'minimum' | 'best' | 'pmfThreshold'>>): KpiThreshold => ({
  minimum: null,
  best: null,
  pmfThreshold: null,
  ...x,
});

const RETENTION_ACTION =
  'Give people a reason to come back on day 2–7: weekly report + 14-day lifecycle sequence (plan §3 bet 4), Buddy Streak with “your turn” pushes (plan 1.3), meal reminders.';
const ACTIVATION_ACTION =
  'Fix the path to the first meal: photo-analysis failures and the “add details” recovery (plan 0.3), the Android onboarding drop (plan 0.2), sign-in failures (plan 0.1).';
const VIRAL_ACTION =
  'Get the first invite sent: onboarding “Who’s doing this with you?” share-link step (plan 1.1), invitee landing that auto-joins the circle (1.2), give 7 / get 7 (1.4), re-prompt after the first meal (1.5).';
const PAID_ACTION =
  'Do not scale spend until a channel clears the plan §4 gates (cost per activated ≤ $25, D7 ≥ 20%, trial start ≥ 15% of activated); move budget to the channel with the lowest cost per activated user.';
const MONETIZATION_ACTION = 'Paywall cadence (plan 1.7): 3- vs 7-day trial, annual-first framing, transaction-abandon offer, expired-trial win-back.';

export const KPI_DEFS: KpiDef[] = [
  // ------------------------------------------------------------------ Retention (PMF score 30%)
  {
    id: 'd1_retention',
    name: 'D1 retention',
    group: 'retention',
    unit: 'percent',
    definition:
      'Share of real sign-ups who were active again on the day after their sign-up day (their own time zone). Active = opened the app (Home feed load / app open) or logged a meal.',
    threshold: t({ direction: 'higher', target: 40, minimum: 25, best: 50, source: 'pmf_doc', sourceLabel: `${PMF} · Cohort retention targets` }),
    maturityDays: 1,
    action: RETENTION_ACTION,
  },
  {
    id: 'd7_retention',
    name: 'D7 retention',
    group: 'retention',
    unit: 'percent',
    definition: 'Share of real sign-ups who were active on the 7th day after their sign-up day (their own time zone).',
    threshold: t({
      direction: 'higher',
      target: 25,
      minimum: 15,
      best: 35,
      source: 'pmf_doc',
      sourceLabel: `${PMF} · Cohort retention targets`,
      note: 'Growth plan gate to scale a paid channel: D7 ≥ 20% for that channel’s cohort.',
    }),
    maturityDays: 7,
    action: RETENTION_ACTION,
  },
  {
    id: 'd30_retention',
    name: 'D30 retention',
    group: 'retention',
    unit: 'percent',
    definition: 'Share of real sign-ups who were active on the 30th day after their sign-up day. Feeds the PMF score (Retention, 30%).',
    threshold: t({ direction: 'higher', target: 15, minimum: 10, best: 25, pmfThreshold: 20, source: 'pmf_doc', sourceLabel: `${PMF} · Cohort retention targets (Series A: 20%+)` }),
    maturityDays: 30,
    action: RETENTION_ACTION,
    pmfComponent: 'retention',
  },
  // ------------------------------------------------------------------ Activation
  {
    id: 'activation_first_meal',
    name: 'Activation (first meal ≤ 7 days)',
    group: 'activation',
    unit: 'percent',
    definition:
      'Share of real sign-ups who logged their first meal (photo, manual, voice — not an Apple Health / Health Connect import) within 7 × 24 h of signing up. The growth plan’s activation definition.',
    threshold: t({
      direction: 'higher',
      target: 60,
      best: 75,
      source: 'pmf_doc',
      sourceLabel: `${PMF} · Activation rate`,
      note: 'The PMF doc sets 60% / 75% for activation, which it defined as joining a first challenge; the growth plan (2026-10-31) redefined activation as the first meal. The doc’s targets are applied to the first-meal definition.',
    }),
    maturityDays: 7,
    action: ACTIVATION_ACTION,
  },
  {
    id: 'time_to_first_meal',
    name: 'Time to first meal (median)',
    group: 'activation',
    unit: 'hours',
    definition: 'Median hours from sign-up to the first logged meal, among sign-ups who logged one within 7 days.',
    threshold: t({ direction: 'lower', target: 2, best: 0.5, source: 'pmf_doc', sourceLabel: `${PMF} · Time to activation (< 2 h; best < 30 min)` }),
    maturityDays: 7,
    action: ACTIVATION_ACTION,
  },
  {
    id: 'onboarding_completion',
    name: 'Onboarding completion',
    group: 'activation',
    unit: 'percent',
    definition: 'Share of real sign-ups whose onboarding is marked complete (profiles.onboarding_completed), measured from the day after sign-up.',
    threshold: t({
      direction: 'higher',
      target: 80,
      best: 90,
      source: 'pmf_doc',
      sourceLabel: `${PMF} · Profile completion rate`,
      note: 'Growth plan 0.2: Android onboarding completion within 15 points of iOS.',
    }),
    maturityDays: 1,
    action: 'Fix the Android onboarding drop at meet_fitzy → profile and remove the legacy flow (plan 0.2).',
  },
  {
    id: 'social_activation',
    name: 'Social activation (circle with a friend ≤ 7 days)',
    group: 'activation',
    unit: 'percent',
    definition:
      'Share of real sign-ups who, within 7 days, were in a private (non-public) circle at the same time as at least one other real member. Same rule as Ads → Virality “socially activated”.',
    threshold: t({
      direction: 'higher',
      target: 60,
      best: 75,
      source: 'pmf_doc',
      sourceLabel: `${PMF} · Activation rate (join first challenge)`,
      note: 'The PMF doc’s original activation event is joining a first challenge; public / demo circles never count here.',
    }),
    maturityDays: 7,
    action: VIRAL_ACTION,
  },
  // ------------------------------------------------------------------ Engagement (PMF score 25%)
  {
    id: 'dau',
    name: 'Daily active users (avg)',
    group: 'engagement',
    unit: 'count',
    definition: 'Average number of distinct real users active per day (app open / Home feed load / meal logged), report time zone.',
    threshold: t({ direction: 'higher', target: 10_000, best: 200_000, pmfThreshold: 100_000, source: 'pmf_doc', sourceLabel: `${PMF} · DAU (Month 3 target; PMF threshold 100,000)` }),
    maturityDays: null,
    action: 'Scale only after retention holds; DAU follows sign-ups × retention.',
  },
  {
    id: 'mau',
    name: 'Monthly active users',
    group: 'engagement',
    unit: 'count',
    definition: 'Distinct real users active in the 30 days ending on the window’s last day.',
    threshold: t({ direction: 'higher', target: 30_000, best: 600_000, pmfThreshold: 300_000, source: 'pmf_doc', sourceLabel: `${PMF} · MAU (Month 3 target; PMF threshold 300,000)` }),
    maturityDays: null,
    action: 'Scale only after retention holds; MAU follows sign-ups × retention.',
  },
  {
    id: 'stickiness',
    name: 'Stickiness (DAU / MAU)',
    group: 'engagement',
    unit: 'percent',
    definition: 'For each day: active users that day ÷ users active in the 30 days ending that day; averaged over the window. Feeds the PMF score (Engagement, 25%).',
    threshold: t({ direction: 'higher', target: 33, minimum: 25, best: 50, source: 'pmf_doc', sourceLabel: `${PMF} · DAU/MAU ratio` }),
    maturityDays: null,
    action: RETENTION_ACTION,
    pmfComponent: 'engagement',
  },
  {
    id: 'meal_logging_frequency',
    name: 'Meal-logging days per week',
    group: 'engagement',
    unit: 'days_per_week',
    definition: 'Among real users who logged at least one meal in the window: average distinct days per week with a logged meal.',
    threshold: t({
      direction: 'higher',
      target: 3,
      source: 'benchmark',
      sourceLabel: 'Common benchmark (not in our docs)',
      note: 'Rule of thumb for a habit-forming tracker: logging on 3+ days a week. Our docs set no target for logging frequency.',
    }),
    maturityDays: null,
    action: 'Meal reminders at the user’s usual meal times, Buddy Streak “your turn” pushes (plan 1.3).',
  },
  {
    id: 'buddy_wau',
    name: 'North star: weekly actives with an active buddy',
    group: 'engagement',
    unit: 'count',
    definition:
      'Real users active in a week who share a private circle with at least one other real user active that same week; average per week in the window. The growth plan’s north-star metric.',
    threshold: null,
    maturityDays: null,
    action: VIRAL_ACTION,
    notes: ['The growth plan names this the north star but sets no target; tracked for trend only.'],
  },
  {
    id: 'sessions_per_dau',
    name: 'Sessions per DAU',
    group: 'engagement',
    unit: 'ratio',
    definition: 'Average app sessions per daily active user.',
    threshold: t({ direction: 'higher', target: 2.5, source: 'pmf_doc', sourceLabel: `${PMF} · Session metrics` }),
    maturityDays: null,
    action: '',
    notMeasured: {
      reason: 'Sessions exist only in Amplitude; the database records one app open per user per day (app_opens), not sessions or their length.',
      needed: 'A server-side session log (or an Amplitude export into the warehouse) with session start/end per user.',
    },
  },
  {
    id: 'session_duration',
    name: 'Average session duration',
    group: 'engagement',
    unit: 'count',
    definition: 'Average minutes per app session.',
    threshold: t({ direction: 'higher', target: 8, source: 'pmf_doc', sourceLabel: `${PMF} · Session metrics (8+ minutes)` }),
    maturityDays: null,
    action: '',
    notMeasured: {
      reason: 'Session length is not stored in the database.',
      needed: 'Session start/end events in the database or an Amplitude export.',
    },
  },
  // ------------------------------------------------------------------ Growth (PMF score 20%)
  {
    id: 'k_factor',
    name: 'Viral coefficient (K, 7-day)',
    group: 'growth',
    unit: 'ratio',
    definition:
      'New real users brought in by a cohort within 7 days of each inviter’s sign-up (valid referral or a join into their private circle) ÷ cohort sign-ups. Same rule as Ads → Virality. Feeds the PMF score (Growth, 20%).',
    threshold: t({
      direction: 'higher',
      target: 0.6,
      minimum: 0.2,
      best: 1.2,
      pmfThreshold: 1.0,
      source: 'pmf_doc',
      sourceLabel: `${PMF} · K-factor (current target 0.6; PMF 1.0) · minimum = ${PLAN} (K ≥ 0.2)`,
      note: 'Shares from the iOS / Android share sheet are invisible to the database, so this is a lower bound.',
    }),
    maturityDays: 7,
    action: VIRAL_ACTION,
    pmfComponent: 'growth',
  },
  {
    id: 'invite_rate',
    name: 'Invite rate',
    group: 'growth',
    unit: 'percent',
    definition: 'Share of real sign-ups who invited someone within 7 days by any database-visible route (invite sent, referral claimed, or a friend joined their private circle).',
    threshold: t({ direction: 'higher', target: 25, minimum: 10, source: 'growth_plan', sourceLabel: `${PLAN} (≥ 25% of onboarders invite; < 10% = buddy loop failed)` }),
    maturityDays: 7,
    action: VIRAL_ACTION,
  },
  {
    id: 'invite_join_rate',
    name: 'Invite → join',
    group: 'growth',
    unit: 'percent',
    definition: 'Of invites the cohort sent (referral_invites), the share that led to a valid sign-up / join (to date).',
    threshold: t({ direction: 'higher', target: 20, source: 'growth_plan', sourceLabel: `${PLAN} (≥ 20% of invites lead to a join)` }),
    maturityDays: 7,
    action: 'Invitee landing that opens straight into the inviter’s circle with their face and name (plan 1.2).',
  },
  {
    id: 'organic_share',
    name: 'Organic share of sign-ups',
    group: 'growth',
    unit: 'percent',
    definition:
      'Share of real sign-ups attributed to organic or to a friend’s invite (not Apple Ads / Google Ads / Meta). Sign-ups with unknown attribution count as not organic, so this is a lower bound.',
    threshold: t({ direction: 'higher', target: 30, best: 50, source: 'pmf_doc', sourceLabel: `${PMF} · Organic growth rate` }),
    maturityDays: 0,
    action: 'Creator-led acquisition and the ASO move into the social lane (plan 1.6, 1.8); ratings prompt at peak moments.',
  },
  // ------------------------------------------------------------------ Monetization / economics (PMF score 10%)
  {
    id: 'trial_start_rate',
    name: 'Trial start (of activated)',
    group: 'monetization',
    unit: 'percent',
    definition: 'Of real sign-ups who logged a meal within 7 days, the share who started a store free trial (to date).',
    threshold: t({ direction: 'higher', target: 15, source: 'growth_plan', sourceLabel: `${PLAN} (trial start ≥ 15% of activated users)` }),
    maturityDays: 7,
    action: MONETIZATION_ACTION,
  },
  {
    id: 'paywall_to_trial',
    name: 'Paywall → trial',
    group: 'monetization',
    unit: 'percent',
    definition: 'Of real sign-ups who saw the onboarding paywall (profiles.onboarding_paywall_at), the share who started a free trial (to date). Older clients never record the paywall view.',
    threshold: t({
      direction: 'higher',
      target: 10,
      source: 'benchmark',
      sourceLabel: 'Common benchmark (not in our docs)',
      note: 'Rule of thumb for an onboarding paywall with a free trial: ~10% of paywall viewers start a trial. Our docs set no target.',
    }),
    maturityDays: 7,
    action: MONETIZATION_ACTION,
  },
  {
    id: 'trial_to_paid',
    name: 'Trial → paid',
    group: 'monetization',
    unit: 'percent',
    definition: 'Of free trials started in the window whose trial period has ended, the share that turned into a paid, unrefunded charge.',
    threshold: t({
      direction: 'higher',
      target: 40,
      source: 'benchmark',
      sourceLabel: 'Common benchmark (not in our docs)',
      note: 'Rule of thumb for subscription apps with a short free trial: ~40% of trials convert. Our docs set no target.',
    }),
    maturityDays: 0,
    action: 'Trial-ending reminder and expired-trial win-back (plan 1.7).',
  },
  {
    id: 'paid_conversion',
    name: 'Paid conversion',
    group: 'monetization',
    unit: 'percent',
    definition: 'Share of real sign-ups who have paid (≥ 1 unrefunded paid charge, to date).',
    threshold: t({ direction: 'higher', target: 15, minimum: 5, best: 25, source: 'pmf_doc', sourceLabel: `${PMF} · Fitness app benchmarks (target 15%, industry avg 5%, top 25%)` }),
    maturityDays: 7,
    action: MONETIZATION_ACTION,
  },
  {
    id: 'cost_per_activated',
    name: 'Cost per activated user (paid)',
    group: 'monetization',
    unit: 'usd',
    definition: 'Ad spend on the window’s days ÷ paid-channel sign-ups of those days who logged a meal within 7 days.',
    threshold: t({ direction: 'lower', target: 25, source: 'growth_plan', sourceLabel: `${PLAN} (≤ $25 to scale a channel)` }),
    maturityDays: 7,
    action: PAID_ACTION,
    notes: ['Ads Console “activated” also counts a manual check-in, so its cost per activated can be lower than this.'],
  },
  {
    id: 'paid_cac',
    name: 'Paid CAC (per paid sign-up)',
    group: 'monetization',
    unit: 'usd',
    definition: 'Ad spend on the window’s days ÷ real sign-ups attributed to Apple Ads, Google Ads or Meta on those days.',
    threshold: t({ direction: 'lower', target: 35, source: 'pmf_doc', sourceLabel: `${PMF} · Paid CAC target` }),
    maturityDays: 0,
    action: PAID_ACTION,
  },
  {
    id: 'blended_cac',
    name: 'Blended CAC',
    group: 'monetization',
    unit: 'usd',
    definition: 'Ad spend on the window’s days ÷ all real sign-ups on those days (organic included).',
    threshold: t({ direction: 'lower', target: 25, source: 'pmf_doc', sourceLabel: `${PMF} · Blended CAC target` }),
    maturityDays: 0,
    action: PAID_ACTION,
  },
  {
    id: 'ltv_cac',
    name: 'LTV / CAC (to-date proxy)',
    group: 'monetization',
    unit: 'ratio',
    definition:
      'Net subscription revenue to date of the window’s paid-channel sign-ups ÷ ad spend on those days (cash basis, no LTV projection — it understates long-run value). Feeds the PMF score (Economic, 10%).',
    threshold: t({ direction: 'higher', target: 2, best: 5, pmfThreshold: 3, source: 'pmf_doc', sourceLabel: `${PMF} · LTV/CAC (Month 3 target 2.0; PMF 3.0+)` }),
    maturityDays: 7,
    action: PAID_ACTION,
    pmfComponent: 'economic',
  },
  {
    id: 'ltv_30d',
    name: '30-day revenue per sign-up',
    group: 'monetization',
    unit: 'usd',
    definition: 'Net subscription revenue in each real sign-up’s first 30 days, averaged over the cohort (ads revenue not included).',
    threshold: t({ direction: 'higher', target: 25, source: 'pmf_doc', sourceLabel: `${PMF} · 30-day LTV target` }),
    maturityDays: 30,
    action: MONETIZATION_ACTION,
  },
  {
    id: 'arpu_monthly',
    name: 'ARPU (monthly, subscriptions)',
    group: 'monetization',
    unit: 'usd',
    definition: 'Net monthly recurring revenue (MRR after store fees) at the window’s end ÷ monthly active users. AdMob ad revenue is not included.',
    threshold: t({ direction: 'higher', target: 7.5, source: 'pmf_doc', sourceLabel: `${PMF} · Blended ARPU target`, note: 'The doc’s $7.50 blends ad ARPU ($2.50 free users); this measure has subscriptions only.' }),
    maturityDays: null,
    action: MONETIZATION_ACTION,
  },
  {
    id: 'subscriber_churn',
    name: 'Subscriber churn (monthly-equivalent)',
    group: 'monetization',
    unit: 'percent',
    definition:
      'Of paid subscriptions active at the window’s start, the share no longer active at its end (expired or refunded), converted to a 30-day rate: 1 − (1 − c)^(30 ÷ window days).',
    threshold: t({ direction: 'lower', target: 10, best: 3, pmfThreshold: 5, source: 'pmf_doc', sourceLabel: `${PMF} · Monthly churn (Month 3 < 10%; PMF < 5%)` }),
    maturityDays: null,
    action: 'Pro lifecycle prompts before renewal, win-back for expired subscribers.',
  },
  // ------------------------------------------------------------------ Satisfaction (PMF score 15%)
  {
    id: 'nps',
    name: 'Net Promoter Score',
    group: 'satisfaction',
    unit: 'score',
    definition: '% promoters (9–10) − % detractors (0–6) on “How likely are you to recommend FitCircle?”. Feeds the PMF score (Satisfaction, 15%).',
    threshold: t({ direction: 'higher', target: 30, best: 70, pmfThreshold: 40, source: 'pmf_doc', sourceLabel: `${PMF} · NPS (Month 3 target 30; PMF 40+)` }),
    maturityDays: null,
    action: 'Add an in-app NPS question after day 7 / first circle week.',
    pmfComponent: 'satisfaction',
    notMeasured: {
      reason: 'No NPS survey exists: no table, endpoint or analytics event records an NPS answer.',
      needed: 'An in-app NPS prompt (0–10) stored server-side (e.g. a survey_responses table) — shown after day 7 and quarterly to actives, per the PMF doc.',
    },
  },
  {
    id: 'sean_ellis',
    name: 'Sean Ellis “very disappointed”',
    group: 'satisfaction',
    unit: 'percent',
    definition: 'Share of active users answering “Very disappointed” to “How would you feel if you could no longer use FitCircle?”.',
    threshold: t({ direction: 'higher', target: 40, source: 'benchmark', sourceLabel: 'Common benchmark (not in our docs): Sean Ellis 40% PMF line' }),
    maturityDays: null,
    action: 'Ask the Sean Ellis question to users active 2+ weeks.',
    notMeasured: {
      reason: 'We do not ask the Sean Ellis question anywhere (no table or event).',
      needed: 'A one-question survey to users active for 2+ weeks, stored server-side with the answer and date.',
    },
  },
  {
    id: 'csat',
    name: 'CSAT',
    group: 'satisfaction',
    unit: 'score',
    definition: 'Average satisfaction (1–5) after onboarding and after the first challenge.',
    threshold: t({ direction: 'higher', target: 4.5, source: 'pmf_doc', sourceLabel: `${PMF} · Overall CSAT 4.5 / 5` }),
    maturityDays: null,
    action: 'Post-onboarding 1–5 rating.',
    notMeasured: {
      reason: 'No satisfaction rating is collected. The rating prompt asks for a store rating; stores do not report who rated or the score.',
      needed: 'An in-app 1–5 rating stored server-side (post-onboarding, day 30).',
    },
  },
];

export const KPI_BY_ID = new Map(KPI_DEFS.map((d) => [d.id, d]));

export const PMF_SCORE_BANDS = [
  { min: 0, max: 40, label: 'No PMF — pivot required' },
  { min: 41, max: 60, label: 'Weak PMF — major improvements needed' },
  { min: 61, max: 75, label: 'Emerging PMF — optimize and iterate' },
  { min: 76, max: 85, label: 'Strong PMF — ready to scale' },
  { min: 86, max: 100, label: 'Exceptional PMF — aggressive growth' },
];

export const SOURCES = [
  { id: 'pmf_doc' as const, label: 'PMF-METRICS.md', detail: 'FitCircle PMF Metrics Framework v1.0 (docs/PMF-METRICS.md): targets, minimum viable and best-in-class values, PMF score formula.' },
  {
    id: 'growth_plan' as const,
    label: 'Growth plan',
    detail: 'Growth strategy and operating plan (2026-10-31) §4 gates for scaling a paid channel and for the buddy loop; §5 north star.',
  },
  { id: 'benchmark' as const, label: 'Common benchmark', detail: 'Not in our docs. A widely used rule of thumb, shown only where our docs set no threshold.' },
];

/** Below this n a rate moves > ~3 points per user; flagged “small sample”. */
export const LOW_SAMPLE_N = 30;
/** Below this n we do not judge status (shown as data, chip “too few”). */
export const MIN_STATUS_N = 5;
