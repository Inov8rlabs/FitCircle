/**
 * "Don't miss twice" + streak save offer: the D+1 push (docs/ENGAGEMENT_115_SPEC.md §5.1–5.2). PURE.
 *
 *   D       = the first missed day: no claim BY THE USER (an automatic nightly shield still
 *             counts as missed: that is the `shield_saved` variant), while D−1 has a claim.
 *   episode = D. One dont_miss_twice OR one streak_save_offer per D, never both, never again;
 *             a new episode needs a day the user claimed after the previous D.
 *   D+1     = today in the user's push zone, at their send hour.
 *
 * No emoji. Every number in the copy is the user's own (streak length, shields left, the
 * hour and slot they usually log).
 */
import { localDay, localMidnight } from '../circles/challenge-steps';
import { addDays } from '../streaks/streak-calculator';

/** A streak_claims row for one local day. `auto` = an automatic nightly shield (freeze + auto_applied). */
export interface DayClaim {
  date: string;
  method: string | null;
  auto: boolean;
}

export type DmtVariant = 'shield_saved' | 'meal' | 'workout' | 'streak_restart' | 'plain';
export type DmtPushType = 'dont_miss_twice' | 'streak_save_offer';

export type DmtSkip =
  | 'claimed_yesterday'
  | 'claimed_today'
  | 'not_first_miss'
  | 'same_episode'
  | 'already_sent'
  | 'outside_send_hour'
  | 'switched_off';

/** Earliest / latest local send hour (spec: modal first-log hour clamped to 8–20). */
export const SEND_HOUR_MIN = 8;
export const SEND_HOUR_MAX = 20;
export const SEND_HOUR_FALLBACK = 12;
/** History window for the slot / hour / activity facts. */
export const HISTORY_DAYS = 14;
/** Below this many active days in the window the copy is the plain variant. */
export const MIN_HISTORY_DAYS = 3;
/** A D+1 push delivered this recently counts as the day's touch for momentum / win-back triggers. */
export const DMT_TOUCH_HOURS = 20;
/** …and as the win-back day-3 touch (the step slides a day). */
export const DMT_WINBACK_TOUCH_HOURS = 44;
export const DMT_PUSH_TYPES: readonly DmtPushType[] = ['dont_miss_twice', 'streak_save_offer'];

/** Hard kill (env). OFF unless explicitly enabled: it also retires the night streak_lost / shield_applied pushes. */
export function dontMissTwiceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ['1', 'true', 'on', 'yes'].includes((env.DONT_MISS_TWICE_PUSH_ENABLED ?? '').trim().toLowerCase());
}

export const dmtDedupeKey = (type: DmtPushType, missedDate: string): string =>
  type === 'streak_save_offer' ? `streak_save:${missedDate}` : `dmt:${missedDate}`;

const isUserClaim = (c: DayClaim | undefined): boolean => !!c && !c.auto;

/**
 * The first missed day for `today` (D = yesterday), or why there is none. `claims` = every
 * claim in the last few weeks keyed by local date.
 */
export function firstMissedDay(claims: ReadonlyMap<string, DayClaim>, today: string): { missedDate: string } | { skip: DmtSkip } {
  const d = addDays(today, -1);
  if (isUserClaim(claims.get(d))) return { skip: 'claimed_yesterday' };
  if (claims.has(today)) return { skip: 'claimed_today' };
  if (!claims.has(addDays(d, -1))) return { skip: 'not_first_miss' };
  return { missedDate: d };
}

/**
 * Same lapse episode as an earlier D+1 push? `previousMissedDates` = missedDate of every
 * dont_miss_twice / streak_save_offer push already delivered (recent ones are enough).
 */
export function episodeSkip(missedDate: string, previousMissedDates: readonly string[], claims: ReadonlyMap<string, DayClaim>): DmtSkip | null {
  for (const prev of previousMissedDates) {
    if (prev === missedDate) return 'already_sent';
    if (prev > missedDate) continue;
    // A new episode needs a day the USER claimed after the previous D (and before this one).
    let claimedSince = false;
    for (let day = addDays(prev, 1); day < missedDate; day = addDays(day, 1)) {
      if (isUserClaim(claims.get(day))) {
        claimedSince = true;
        break;
      }
    }
    if (!claimedSince) return 'same_episode';
  }
  return null;
}

/** Consecutive automatic shields ending at `day` (inclusive). */
export function trailingAutoShields(claims: ReadonlyMap<string, DayClaim>, day: string): number {
  let n = 0;
  for (let cursor = day; claims.get(cursor)?.auto; cursor = addDays(cursor, -1)) n++;
  return n;
}

/** The most frequent value (ties → the smaller value, so the result is stable); null when empty. */
export function modal(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  for (const [v, c] of counts) {
    const bc = best === null ? -1 : (counts.get(best) as number);
    if (c > bc || (c === bc && v < (best as number))) best = v;
  }
  return best;
}

const parseHm = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is local hour `h` (its whole :00–:59) inside quiet hours start→end ("HH:MM", may wrap midnight)? */
function hourInQuiet(h: number, start: string, end: string): boolean {
  const s = parseHm(start);
  const e = parseHm(end);
  if (s === e) return false;
  const inside = (m: number) => (s < e ? m >= s && m < e : m >= s || m < e);
  return inside(h * 60) || inside(h * 60 + 59);
}

/**
 * Send hour: the modal local hour of the first manual log of the day (last 14 days), clamped to
 * 8–20 (fallback 12). Inside quiet hours → the first whole hour after quiet hours end.
 */
export function sendHour(firstLogHours: readonly number[], quiet: { start: string; end: string } | null): number {
  const m = modal(firstLogHours);
  let h = m === null ? SEND_HOUR_FALLBACK : Math.min(SEND_HOUR_MAX, Math.max(SEND_HOUR_MIN, m));
  if (quiet && hourInQuiet(h, quiet.start, quiet.end)) {
    const end = parseHm(quiet.end);
    h = Math.ceil(end / 60) % 24;
    for (let i = 0; i < 24 && hourInQuiet(h, quiet.start, quiet.end); i++) h = (h + 1) % 24;
  }
  return h;
}

/** "8 am", "12 pm", "7 pm". */
export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return `${twelve} ${hh < 12 ? 'am' : 'pm'}`;
}

/** "breakfast" / "lunch" / "dinner" / "a snack"; null for other / unknown slots. */
export function slotWord(mealType: string | null | undefined): string | null {
  switch (mealType) {
    case 'breakfast':
    case 'lunch':
    case 'dinner':
      return mealType;
    case 'snack':
      return 'a snack';
    default:
      return null;
  }
}

export interface ActivityFacts {
  /** Distinct local days with a food log in the last 14 days. */
  foodDays: number;
  /** Distinct local days with a workout (manual or synced) in the last 14 days. */
  workoutDays: number;
  /** Most-logged meal_type in the last 14 days. */
  topSlot: string | null;
  /** Modal local hour of the first log of the day. */
  usualHour: number | null;
}

/** Distinct days, top slot and the hours of each day's first log, from raw rows (local dates / hours). */
export function activityFacts(
  food: ReadonlyArray<{ day: string; hour: number; mealType: string | null }>,
  workoutDays: ReadonlyArray<string>
): ActivityFacts {
  const firstByDay = new Map<string, number>();
  const slots: string[] = [];
  for (const f of food) {
    const prev = firstByDay.get(f.day);
    if (prev === undefined || f.hour < prev) firstByDay.set(f.day, f.hour);
    if (slotWord(f.mealType)) slots.push(f.mealType as string);
  }
  const slotCounts = new Map<string, number>();
  for (const s of slots) slotCounts.set(s, (slotCounts.get(s) ?? 0) + 1);
  const order = ['breakfast', 'lunch', 'dinner', 'snack'];
  let topSlot: string | null = null;
  for (const [s, c] of slotCounts) {
    const bc = topSlot ? (slotCounts.get(topSlot) as number) : -1;
    if (c > bc || (c === bc && order.indexOf(s) < order.indexOf(topSlot as string))) topSlot = s;
  }
  return {
    foodDays: firstByDay.size,
    workoutDays: new Set(workoutDays).size,
    topSlot,
    usualHour: modal([...firstByDay.values()]),
  };
}

export interface DmtBreak {
  broken: boolean;
  zombieGuard: boolean;
  lostStreak: number;
}

export interface DmtChoiceInput {
  /** D is covered by an automatic nightly shield. */
  shieldSavedD: boolean;
  /** The streak as it stands after the shield (shield_saved only). */
  currentStreak: number;
  /** Free shields left after the shield (null = Pro / unlimited). */
  shieldsLeft: number | null;
  /** This was the last automatic save before the zombie guard. */
  lastAutoProtect: boolean;
  outcome: DmtBreak;
  saveOfferOn: boolean;
  saveOfferMinStreak: number;
  activity: ActivityFacts;
}

export interface DmtChoice {
  type: DmtPushType;
  variant: DmtVariant | 'save_offer';
}

/** Which push and which variant (§5.2 step 5). */
export function chooseDmt(i: DmtChoiceInput): DmtChoice {
  if (i.shieldSavedD) return { type: 'dont_miss_twice', variant: 'shield_saved' };
  const b = i.outcome;
  if (b.broken && !b.zombieGuard && i.saveOfferOn && b.lostStreak >= i.saveOfferMinStreak) {
    return { type: 'streak_save_offer', variant: 'save_offer' };
  }
  if (b.broken && (b.zombieGuard || b.lostStreak < i.saveOfferMinStreak)) return { type: 'dont_miss_twice', variant: 'streak_restart' };
  const a = i.activity;
  if (a.foodDays + a.workoutDays < MIN_HISTORY_DAYS) return { type: 'dont_miss_twice', variant: 'plain' };
  if (a.workoutDays > a.foodDays) return { type: 'dont_miss_twice', variant: 'workout' };
  if (a.foodDays > 0 && slotWord(a.topSlot) && a.usualHour !== null) return { type: 'dont_miss_twice', variant: 'meal' };
  return { type: 'dont_miss_twice', variant: 'plain' };
}

export interface DmtCopy {
  title: string;
  body: string;
  screen: 'food_log' | 'exercise_log' | 'dashboard' | 'streaks';
  route: string | null;
  mealType: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Title / body / screen per variant (§5.2 table). */
export function dmtCopy(choice: DmtChoice, i: DmtChoiceInput & { pro: boolean }): DmtCopy {
  const slot = slotWord(i.activity.topSlot);
  const mealType = slot ? i.activity.topSlot : null;
  const food = (title: string, body: string): DmtCopy => ({ title, body, screen: 'food_log', route: 'log_meal_camera', mealType });
  switch (choice.variant) {
    case 'save_offer': {
      const n = i.outcome.lostStreak;
      return {
        title: `Save your ${n}-day streak`,
        body: i.pro
          ? `You missed yesterday. Use a shield and keep all ${n} days. Today only.`
          : `You missed yesterday. A streak shield can still keep all ${n} days. Today only.`,
        screen: 'streaks',
        route: 'streak_save',
        mealType: null,
      };
    }
    case 'shield_saved': {
      const tail = i.lastAutoProtect
        ? ' That was your last automatic save, so today counts.'
        : i.pro || i.shieldsLeft === null
          ? ''
          : i.shieldsLeft === 0
            ? ' No shields left.'
            : ` ${plural(i.shieldsLeft, 'shield')} left.`;
      return food(`A shield saved your ${i.currentStreak}-day streak`, `Log ${slot ?? 'a meal'} today to keep it going.${tail}`);
    }
    case 'meal':
      return food("Don't miss two days", `You usually log ${slot} around ${hourLabel(i.activity.usualHour ?? SEND_HOUR_FALLBACK)}. Snap today's and you're back on track.`);
    case 'workout':
      return { title: "Don't miss two days", body: "One workout or one meal today and you're back on track.", screen: 'exercise_log', route: null, mealType: null };
    case 'streak_restart':
      return food('Yesterday slipped by', 'Log one meal today and day 1 of your next streak is yours.');
    case 'plain':
    default:
      return food("Don't miss two days", "Log one meal today and you're back on track.");
  }
}

/**
 * When a save offer for D expires: the end of D+1 in the user's zone plus the 3 am grace
 * (GRACE_PERIOD_HOURS), i.e. local midnight of D+2 + grace.
 */
export function saveOfferExpiresAt(missedDate: string, timezone: string, graceHours: number): Date {
  return new Date(localMidnight(addDays(missedDate, 2), timezone).getTime() + graceHours * 3_600_000);
}

/** The local day (YYYY-MM-DD) and hour of an instant in a zone. */
export function localDayHour(iso: string, timezone: string): { day: string; hour: number } {
  const d = new Date(iso);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(d)) % 24;
  return { day: localDay(d, timezone), hour };
}
