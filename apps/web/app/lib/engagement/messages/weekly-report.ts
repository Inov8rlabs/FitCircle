/**
 * Weekly report (message key `weekly_report`): facts in → MessagePlan out.
 * Pure and deterministic per (user, ISO week), so previews, dry runs and the
 * real send all produce the same email. See docs/ENGAGEMENT_MESSAGING.md §4.
 *
 * Rules:
 *  - fully dormant (no activity this week or the 4 before) → skip;
 *  - zero activity this week but some recently → short "fresh start" email;
 *  - a stat tile appears only when we have that data for this person;
 *  - the hero + subject are keyed off what happened (best / comeback /
 *    consistent / building / quiet week), with rotating copy;
 *  - the growth slot rotates, is skipped ~1 week in 3 (and always after two
 *    weeks in a row with one), never repeats last week's variant and only
 *    offers things relevant to the person.
 */
import { pick, unitHash } from '../config';
import type { CampaignFacts, WeekActivity, WeeklyReportFacts } from '../facts';
import { appScreenUrl, campaignUrl } from '../links';
import { addDays, daysBetween } from '../time';
import type {
  CelebrationBlock,
  CircleBlock,
  ContentBlock,
  GoalsBlock,
  GrowthBlock,
  MessagePlan,
  SkipReason,
  StatTile,
} from '../types';

export const WEEKLY_REPORT_TEMPLATE = 'weekly_report@1';

export type WeekType = 'best_week' | 'comeback' | 'consistent' | 'building' | 'quiet' | 'fresh_start';

export type GrowthVariant = 'invite_friend' | 'create_circle' | 'join_campaign' | 'try_fitzy' | 'try_photo';

export const GROWTH_VARIANTS: readonly GrowthVariant[] = [
  'invite_friend',
  'create_circle',
  'join_campaign',
  'try_fitzy',
  'try_photo',
];

const KG_TO_LB = 2.20462;

// ---------------------------------------------------------------------------
// Week classification
// ---------------------------------------------------------------------------

export function classifyWeek(f: WeeklyReportFacts): WeekType | { skip: SkipReason } {
  const n = f.thisWeek.activeDays;
  if (n === 0) {
    return f.activeDaysPrior4Weeks > 0 ? 'fresh_start' : { skip: 'dormant' };
  }
  if (f.bestPriorActiveDays !== null && n >= 3 && n > f.bestPriorActiveDays) return 'best_week';
  const hadHistory = f.activeDaysPrior4Weeks > f.lastWeek.activeDays || (f.bestPriorActiveDays ?? 0) > 0;
  if (f.lastWeek.activeDays === 0 && hadHistory) return 'comeback';
  if (n >= 5) return 'consistent';
  if (n >= 2 && n >= f.lastWeek.activeDays) return 'building';
  return 'quiet';
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

interface HeroCopy {
  subjects: Array<(name: string, n: number) => string>;
  /** Subjects usable without a first name. */
  anonymousSubjects: Array<(n: number) => string>;
  title: (n: number) => string;
  body: (n: number, f: WeeklyReportFacts) => string;
  preheader: (n: number) => string;
}

const HERO: Record<WeekType, HeroCopy> = {
  best_week: {
    subjects: [
      (name) => `${name}, that was your best week yet`,
      () => 'Your best week on FitCircle so far',
      (_, n) => `New personal best: ${n} active days`,
    ],
    anonymousSubjects: [() => 'Your best week on FitCircle so far', (n) => `New personal best: ${n} active days`],
    title: () => 'Your best week yet',
    body: (n) => `You showed up on ${days(n)} this week, more than any week before. That is what momentum looks like.`,
    preheader: (n) => `${n} active days, a new personal best. Here's your week.`,
  },
  comeback: {
    subjects: [(name) => `Welcome back, ${name}`, () => "You're back, and it shows", () => 'Look who is back on track'],
    anonymousSubjects: [() => "You're back, and it shows", () => 'Look who is back on track'],
    title: () => 'Good to have you back',
    body: (n) =>
      `After a quiet stretch you logged ${days(n)} this week. Starting again is the hardest part, and you already did it.`,
    preheader: () => 'Restarting is the hardest part. You did it. Here is your week.',
  },
  consistent: {
    subjects: [
      (name, n) => `${n} out of 7. Nice week, ${name}`,
      (_, n) => `Your week in review: ${n} active days`,
      () => 'Consistency looks good on you',
    ],
    anonymousSubjects: [(n) => `Your week in review: ${n} active days`, () => 'Consistency looks good on you'],
    title: (n) => `${n} of 7 days. That's consistency.`,
    body: () => 'Small, steady days add up to big change. Here is what your week looked like.',
    preheader: (n) => `${n} active days this week. Here's the recap.`,
  },
  building: {
    subjects: [(name) => `${name}, here's your week`, () => 'Your week in review', () => "You're building something"],
    anonymousSubjects: [() => 'Your week in review', () => "You're building something"],
    title: () => "You're building momentum",
    body: (n, f) =>
      `${days(n)} active this week${f.lastWeek.activeDays > 0 && n > f.lastWeek.activeDays ? `, up from ${f.lastWeek.activeDays}` : ''}. Here is the recap and a simple plan for next week.`,
    preheader: (n) => `${days(n)} active this week. Here's the recap and a plan for next week.`,
  },
  quiet: {
    subjects: [(name) => `${name}, your week at a glance`, () => 'A quick look at your week', () => 'Your week in review'],
    anonymousSubjects: [() => 'A quick look at your week', () => 'Your week in review'],
    title: () => 'A lighter week, and that is okay',
    body: (n) =>
      `Some weeks are busier than others. You still showed up on ${days(n)}. Here is a simple plan to build on it.`,
    preheader: () => 'Every week counts. Here is yours, plus an easy plan for next week.',
  },
  fresh_start: {
    subjects: [(name) => `${name}, ready for a fresh start?`, () => 'A fresh week starts tomorrow', () => 'New week, clean slate'],
    anonymousSubjects: [() => 'A fresh week starts tomorrow', () => 'New week, clean slate'],
    title: () => 'A fresh week starts tomorrow',
    body: () => 'This week was a quiet one, and that is fine. One logged meal tomorrow is all it takes to get going again.',
    preheader: () => 'New week, clean slate. One small step is all it takes.',
  },
};

// ---------------------------------------------------------------------------
// Stats (only what we have)
// ---------------------------------------------------------------------------

function delta(curr: number, prev: number | null, unit = ''): Pick<StatTile, 'delta' | 'trend'> {
  if (prev === null) return {};
  if (curr === prev) return { delta: 'Same as last week', trend: 'flat' };
  if (curr > prev) return { delta: `+${fmt(curr - prev)}${unit} vs last week`, trend: 'up' };
  return { delta: `${fmt(prev)}${unit} last week`, trend: 'down' };
}

const avgSteps = (w: WeekActivity) => (w.steps && w.steps.daysWithData > 0 ? w.steps.total / w.steps.daysWithData : null);

export function weightDisplay(kg: number, unit: 'kg' | 'lbs'): string {
  const v = unit === 'lbs' ? kg * KG_TO_LB : kg;
  return `${(Math.round(v * 10) / 10).toFixed(1)} ${unit === 'lbs' ? 'lb' : 'kg'}`;
}

/** Signed weight change for the week, or null when it can't be measured honestly. */
export function weightChangeKg(f: WeeklyReportFacts): number | null {
  const w = f.thisWeek.weight;
  if (!w) return null;
  const baseline = f.lastWeek.weight ? f.lastWeek.weight.last : w.entries >= 2 ? w.first : null;
  if (baseline === null) return null;
  return w.last - baseline;
}

export function buildStatTiles(f: WeeklyReportFacts): StatTile[] {
  const t = f.thisWeek;
  const l = f.lastWeek;
  const tiles: StatTile[] = [];
  tiles.push({ id: 'active_days', label: 'Active days', value: `${t.activeDays}/7`, accent: 'violet', ...delta(t.activeDays, l.activeDays) });
  if (t.meals.count > 0 || l.meals.count > 0) {
    tiles.push({
      id: 'meals',
      label: t.meals.days > 0 ? `Meals · ${days(t.meals.days)}` : 'Meals logged',
      value: fmt(t.meals.count),
      accent: 'orange',
      ...delta(t.meals.count, l.meals.count),
    });
  }
  if (t.workouts.count > 0 || l.workouts.count > 0) {
    tiles.push({
      id: 'workouts',
      label: t.workouts.minutes > 0 ? `Workouts · ${fmt(t.workouts.minutes)} min` : 'Workouts',
      value: fmt(t.workouts.count),
      accent: 'green',
      ...delta(t.workouts.count, l.workouts.count),
    });
  }
  const sNow = avgSteps(t);
  if (sNow !== null) {
    const sPrev = avgSteps(l);
    tiles.push({
      id: 'steps',
      label: 'Avg daily steps',
      value: fmt(sNow),
      accent: 'green',
      ...(sPrev !== null ? delta(Math.round(sNow), Math.round(sPrev)) : {}),
    });
  }
  if (f.streak.current > 0) {
    tiles.push({ id: 'streak', label: 'Current streak', value: days(f.streak.current), accent: 'orange' });
  } else if (t.checkIns > 0) {
    tiles.push({ id: 'check_ins', label: 'Check-ins', value: `${t.checkIns}`, accent: 'orange', ...delta(t.checkIns, l.checkIns) });
  }
  if (t.water) {
    tiles.push(
      t.water.daysAtGoal !== null
        ? { id: 'water', label: 'Water goal hit', value: `${t.water.daysAtGoal}/7`, accent: 'cyan', ...(l.water?.daysAtGoal != null ? delta(t.water.daysAtGoal, l.water.daysAtGoal) : {}) }
        : { id: 'water', label: 'Water logged', value: days(t.water.days), accent: 'cyan' }
    );
  }
  const wc = weightChangeKg(f);
  if (wc !== null && t.weight) {
    const shown = f.profile.weightUnit === 'lbs' ? wc * KG_TO_LB : wc;
    const rounded = Math.round(shown * 10) / 10;
    tiles.push({
      id: 'weight',
      label: 'Weight change',
      value: rounded === 0 ? 'Steady' : `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)} ${f.profile.weightUnit === 'lbs' ? 'lb' : 'kg'}`,
      delta: `Latest ${weightDisplay(t.weight.last, f.profile.weightUnit)}`,
      accent: 'violet',
    });
  }
  return tiles.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Biggest win (from real data only)
// ---------------------------------------------------------------------------

export function biggestWin(f: WeeklyReportFacts, type: WeekType): CelebrationBlock | null {
  const t = f.thisWeek;
  const l = f.lastWeek;
  const c: Array<{ score: number; block: CelebrationBlock }> = [];
  const win = (score: number, title: string, body: string) =>
    c.push({ score, block: { kind: 'celebration', eyebrow: 'BIGGEST WIN', title, body } });

  if (type === 'best_week') win(100, `${t.activeDays} active days, your record`, 'You beat your previous best week. Keep that rhythm going.');
  if (f.streak.current >= 7) win(80 + Math.min(f.streak.current, 100) / 10, `${f.streak.current}-day streak`, `You have shown up ${f.streak.current} days in a row. That is a real habit.`);
  const top = f.circles.find((x) => !x.upcoming && x.memberCount >= 2 && x.yourRank === 1 && x.yourActiveDays >= 3);
  if (top) win(75, `Most active in ${top.name}`, `You led your circle with ${days(top.yourActiveDays)} active this week.`);
  if (t.meals.days >= 5) win(70, `Meals logged on ${t.meals.days} of 7 days`, 'Knowing what is on your plate is the foundation of every goal.');
  if (t.workouts.count >= 2 && t.workouts.count > l.workouts.count)
    win(65, `${t.workouts.count} workouts`, l.workouts.count > 0 ? `Up from ${l.workouts.count} last week.` : 'Moving your body more than last week.');
  const sNow = avgSteps(t);
  const sPrev = avgSteps(l);
  if (sNow !== null && sPrev !== null && sPrev > 0 && sNow >= 3000 && sNow >= sPrev * 1.1)
    win(60, `${Math.round((sNow / sPrev - 1) * 100)}% more steps`, `You averaged ${fmt(sNow)} steps a day, up from ${fmt(sPrev)}.`);
  if (t.water?.daysAtGoal != null && t.water.daysAtGoal >= 4) win(55, `Water goal hit on ${t.water.daysAtGoal} days`, 'Staying hydrated makes everything else easier.');
  const wc = weightChangeKg(f);
  if (wc !== null && f.goals.targetWeightKg !== null && t.weight) {
    const before = t.weight.last - wc;
    const towards = Math.abs(f.goals.targetWeightKg - t.weight.last) < Math.abs(f.goals.targetWeightKg - before);
    if (towards && Math.abs(wc) >= 0.2) {
      const amount = weightDisplay(Math.abs(wc), f.profile.weightUnit);
      win(58, `${amount} closer to your goal`, 'Steady progress toward the target you set.');
    }
  }
  if (c.length === 0) return null;
  c.sort((a, b) => b.score - a.score);
  return c[0].block;
}

// ---------------------------------------------------------------------------
// Next week (2–3 concrete targets from the person's own numbers and goals)
// ---------------------------------------------------------------------------

export function nextWeekGoals(f: WeeklyReportFacts): GoalsBlock | null {
  const t = f.thisWeek;
  const items: GoalsBlock['items'] = [];
  if (t.activeDays < 7) {
    const target = Math.min(7, Math.max(3, t.activeDays + 1));
    items.push({ title: target === 7 ? 'Show up all 7 days' : `Show up on ${target} days`, detail: `You had ${days(t.activeDays)} this week. Any meal, workout or check-in counts.` });
  } else {
    items.push({ title: 'Keep your 7-day rhythm', detail: 'Every day this week. Protect the habit you have built.' });
  }
  if (f.goals.dailyStepsTarget && t.steps) {
    const k = Math.min(7, Math.max(2, (t.steps.daysAtGoal ?? 0) + 1));
    items.push({
      title: `Hit ${fmt(f.goals.dailyStepsTarget)} steps on ${k} days`,
      detail: `This week: ${days(t.steps.daysAtGoal ?? 0)} at your step goal.`,
    });
  } else if (t.steps && t.steps.daysWithData >= 3) {
    const avg = avgSteps(t) ?? 0;
    const target = Math.max(3000, Math.ceil((avg * 1.1) / 500) * 500);
    items.push({ title: `Average ${fmt(target)} steps a day`, detail: `About 10% above your ${fmt(avg)} this week.` });
  }
  if (f.mealsEver > 0 && t.meals.days < 7 && items.length < 3) {
    const k = Math.min(7, Math.max(3, t.meals.days + 1));
    items.push({ title: k === 7 ? 'Log meals every day' : `Log meals on ${k} days`, detail: 'Snap a photo and the calories and macros fill in for you.' });
  }
  if (t.workouts.count > 0 && t.workouts.count < 5 && items.length < 3) {
    items.push({ title: `${t.workouts.count + 1} workouts`, detail: `One more than this week's ${t.workouts.count}. A brisk walk counts.` });
  }
  if (t.water && f.goals.dailyWaterMlTarget && items.length < 3) {
    const k = Math.min(7, Math.max(3, (t.water.daysAtGoal ?? 0) + 1));
    items.push({ title: `Hit your water goal on ${k} days`, detail: 'Log a glass in one tap from the home screen.' });
  }
  if (items.length < 2) return null;
  return { kind: 'goals', title: 'Next week', intro: 'Three small targets, built from your own week:', items: items.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

export function circleBlock(f: WeeklyReportFacts): CircleBlock | null {
  const rows = f.circles.slice(0, 2).map((c) => {
    if (c.upcoming) return { name: c.name, line: `Starting soon · ${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'} so far` };
    if (c.memberCount <= 1) return { name: c.name, line: 'Just you so far. Invite a friend to make it a circle.' };
    const rank = c.yourActiveDays > 0 ? ` · you were #${c.yourRank} of ${c.memberCount}` : '';
    return { name: c.name, line: `${c.activeMembersThisWeek} of ${c.memberCount} members active this week${rank}` };
  });
  return rows.length ? { kind: 'circle', title: f.circles.length > 1 ? 'Your circles' : 'Your circle', rows } : null;
}

// ---------------------------------------------------------------------------
// Growth slot
// ---------------------------------------------------------------------------

/** A live (or starting within 14 days) campaign the person hasn't joined. */
export function relevantCampaign(f: WeeklyReportFacts): CampaignFacts | null {
  const today = f.weekEnd;
  const open = f.campaigns
    .filter((c) => !c.joined && c.endsAt >= today && daysBetween(today, c.startsAt) <= 14)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return open[0] ?? null;
}

export function relevantGrowthVariants(f: WeeklyReportFacts): GrowthVariant[] {
  const out: GrowthVariant[] = [];
  if (relevantCampaign(f)) out.push('join_campaign');
  if (f.circles.length === 0) out.push('create_circle');
  if (f.referral && f.thisWeek.activeDays >= 2) out.push('invite_friend');
  if (!f.fitzyUsed && f.mealsEver >= 1) out.push('try_fitzy');
  if (f.mealsEver >= 3 && f.photoMealsEver === 0) out.push('try_photo');
  return out;
}

/**
 * The growth slot for this week, or null (skip). Deterministic per
 * (user, week). `recentGrowthSlots` is newest first ('none' = no slot).
 */
export function selectGrowthSlot(f: WeeklyReportFacts, type: WeekType): GrowthVariant | null {
  if (type === 'fresh_start') return null;
  const [last, beforeLast] = f.recentGrowthSlots;
  const shown = (v: string | undefined) => !!v && v !== 'none';
  if (shown(last) && shown(beforeLast)) return null; // never three weeks in a row
  if (unitHash(f.profile.userId, `growth-skip:${f.weekKey}`) < 1 / 3) return null; // ~1 week in 3
  const candidates = relevantGrowthVariants(f).filter((v) => v !== last);
  if (candidates.length === 0) return null;
  // A timely campaign wins when it's relevant; otherwise rotate deterministically.
  if (candidates.includes('join_campaign')) return 'join_campaign';
  return pick(candidates, f.profile.userId, `growth-pick:${f.weekKey}`);
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function growthBlock(f: WeeklyReportFacts, v: GrowthVariant): GrowthBlock | null {
  switch (v) {
    case 'invite_friend': {
      if (!f.referral) return null;
      const reward =
        f.referral.rewardDays > 0
          ? ` When a friend you invite checks in on ${f.referral.qualifyingDays} days, you both get ${f.referral.rewardDays} days of Pro.`
          : '';
      return {
        kind: 'growth',
        variant: v,
        eyebrow: 'BETTER TOGETHER',
        title: 'Bring a friend into next week',
        body: `Habits stick better with company.${reward} Your link: ${f.referral.link.replace(/^https:\/\//, '')}`,
        cta: { id: 'growth', label: 'Invite a friend', url: appScreenUrl('invite_hub') },
      };
    }
    case 'create_circle':
      return {
        kind: 'growth',
        variant: v,
        eyebrow: 'START A CIRCLE',
        title: 'Start a circle with 2 or 3 friends',
        body: "A circle is a small group that sees each other's check-ins and keeps a streak going together. It takes a minute to set up.",
        cta: { id: 'growth', label: 'Start a circle', url: appScreenUrl('circles') },
      };
    case 'join_campaign': {
      const c = relevantCampaign(f);
      if (!c) return null;
      const live = c.startsAt <= f.weekEnd;
      return {
        kind: 'growth',
        variant: v,
        eyebrow: live ? 'LIVE NOW' : `STARTS ${shortDate(c.startsAt).toUpperCase()}`,
        title: c.title,
        body: `${c.tagline ? `${c.tagline} ` : ''}Runs ${shortDate(c.startsAt)} to ${shortDate(c.endsAt)}. Join and take it on together with your circle.`,
        cta: { id: 'growth', label: live ? `Join ${c.title}` : 'Save my spot', url: campaignUrl(c.slug) },
      };
    }
    case 'try_fitzy':
      return {
        kind: 'growth',
        variant: v,
        eyebrow: 'MEET FITZY',
        title: 'Ask Fitzy about your week',
        body: 'Fitzy is the coach inside FitCircle. Ask what went well in your meals this week and get one easy idea for next week.',
        cta: { id: 'growth', label: 'Chat with Fitzy', url: appScreenUrl('fitzy_chat') },
      };
    case 'try_photo':
      return {
        kind: 'growth',
        variant: v,
        eyebrow: 'SAVE TIME',
        title: 'Snap your next meal instead of typing it',
        body: 'Take a photo and FitCircle estimates calories and macros in seconds. You can adjust anything before saving.',
        cta: { id: 'growth', label: 'Snap a meal', url: appScreenUrl('food_log') },
      };
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function subjectFor(f: WeeklyReportFacts, type: WeekType): { subject: string; variant: string } {
  const copy = HERO[type];
  const n = f.thisWeek.activeDays;
  const name = f.profile.firstName.trim();
  if (name) {
    const i = Math.floor(unitHash(f.profile.userId, `subject:${f.weekKey}`) * copy.subjects.length);
    return { subject: copy.subjects[i](name, n), variant: `${type}_${i + 1}` };
  }
  const i = Math.floor(unitHash(f.profile.userId, `subject:${f.weekKey}`) * copy.anonymousSubjects.length);
  return { subject: copy.anonymousSubjects[i](n), variant: `${type}_anon${i + 1}` };
}

export function buildWeeklyReport(f: WeeklyReportFacts): MessagePlan | { skip: SkipReason } {
  const type = classifyWeek(f);
  if (typeof type !== 'string') return type;
  const n = f.thisWeek.activeDays;
  const copy = HERO[type];
  const { subject, variant: subjectVariant } = subjectFor(f, type);
  const range = `${shortDate(f.weekStart)} – ${shortDate(f.weekEnd)}`;
  const blocks: ContentBlock[] = [
    { kind: 'hero', eyebrow: `YOUR WEEK · ${range.toUpperCase()}`, title: copy.title(n), body: copy.body(n, f) },
  ];
  let growth: GrowthVariant | null = null;

  if (type === 'fresh_start') {
    blocks.push({
      kind: 'list',
      title: 'Three easy ways to restart',
      items: [
        { title: 'Snap one meal', detail: 'A photo is enough. FitCircle fills in the calories and macros.', accent: 'orange' },
        { title: 'Check in tomorrow', detail: 'One tap on the home screen starts a new streak.', accent: 'violet' },
        ...(f.circles.some((c) => !c.upcoming && c.memberCount > 1)
          ? [{ title: 'Say hi to your circle', detail: 'Your friends are still there. A quick message is a great restart.', accent: 'green' as const }]
          : [{ title: 'Take a short walk', detail: 'Ten minutes counts. Log it as a workout when you are back.', accent: 'green' as const }]),
      ],
    });
    blocks.push({ kind: 'cta', cta: { id: 'primary', label: 'Snap a meal', url: appScreenUrl('food_log') } });
  } else {
    const win = biggestWin(f, type);
    if (win) blocks.push(win);
    blocks.push({ kind: 'stat_grid', title: 'This week', tiles: buildStatTiles(f) });
    const circles = circleBlock(f);
    if (circles) blocks.push(circles);
    const goals = nextWeekGoals(f);
    if (goals) blocks.push(goals);
    growth = selectGrowthSlot(f, type);
    const g = growth ? growthBlock(f, growth) : null;
    if (g) blocks.push(g);
    else growth = null;
    blocks.push({ kind: 'cta', cta: { id: 'primary', label: 'Plan my week', url: appScreenUrl('dashboard') } });
  }

  const meals = f.thisWeek.meals.count;
  const pushBody =
    type === 'fresh_start'
      ? 'New week, clean slate. One logged meal is all it takes to get going again.'
      : `${days(n)} active${meals > 0 ? `, ${meals} ${meals === 1 ? 'meal' : 'meals'} logged` : ''}. Your full recap is in your inbox.`;

  return {
    messageKey: 'weekly_report',
    periodKey: f.weekKey,
    medium: 'lifecycle',
    templateVersion: WEEKLY_REPORT_TEMPLATE,
    variants: { hero: type, subject: subjectVariant, growth: growth ?? 'none' },
    goalKey: growth ? `active+${growth}` : 'active',
    email: {
      subject,
      preheader: copy.preheader(n),
      greeting: f.profile.firstName ? `Hi ${f.profile.firstName},` : 'Hi there,',
      blocks,
      footerReason: "You're getting this weekly recap because you have a FitCircle account.",
    },
    push: {
      title: type === 'fresh_start' ? 'A fresh week starts tomorrow' : 'Your week in review',
      body: pushBody,
      screen: 'dashboard',
    },
    meta: { week_type: type, growth_slot: growth ?? 'none', active_days: n, stat_count: type === 'fresh_start' ? 0 : buildStatTiles(f).length },
  };
}

/** Exposed for tests/docs: the local window the report goes out in (Sunday 18:00–21:59). */
export const WEEKLY_REPORT_WINDOW = { isoWeekday: 7, fromHour: 18, toHour: 21 } as const;

/** The week a report sent on local `today` covers (the ISO week ending today). */
export function reportWeekFor(today: string): { start: string; end: string } {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  const start = addDays(today, 1 - weekday);
  return { start, end: addDays(start, 6) };
}
