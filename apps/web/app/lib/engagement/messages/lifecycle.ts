/**
 * Onboarding + re-engagement steps (docs/ENGAGEMENT_MESSAGING.md §3).
 * Behaviour-driven: each step has a condition over LifecycleFacts, its
 * channels, a once-per-period key, a goal (which also stops it: the condition
 * is false once the goal happened) and copy. Pure; the dispatcher handles
 * consent, holdouts, the ledger and sending.
 *
 * Pushes deliberately NOT sent where an existing push already covers the
 * moment (no duplicates):
 *  - first meal  → meal_reminder_* pushes (4 slots) + the first_meal feed card;
 *  - streak milestone → milestone_achieved / shield_earned pushes.
 */
import { pick } from '../config';
import type { CircleFacts, LifecycleFacts } from '../facts';
import { appScreenUrl } from '../links';
import { addDays, daysBetween } from '../time';
import type { Channel, ContentBlock, EmailContent, MessageKey, MessagePlan, PushContent } from '../types';

export const LIFECYCLE_TEMPLATE = 'lifecycle@1';

/** Lifecycle emails go out between these local hours (inclusive). */
export const LIFECYCLE_SEND_HOURS = { from: 9, to: 19 } as const;
/** No two lifecycle emails closer than this. */
export const LIFECYCLE_EMAIL_SPACING_HOURS = 44;
/** At most this many engagement emails (lifecycle + weekly report) per rolling 7 days. */
export const ENGAGEMENT_EMAILS_PER_WEEK = 3;

export const STREAK_MILESTONES = [7, 30, 100, 365] as const;

export interface LifecycleStep {
  key: MessageKey;
  channels: Channel[];
  goalKey: string;
  /** Re-send guard on top of the period key (e.g. comeback at most every 14 days). */
  cooldownDays?: number;
  /** The period key when due, else null. */
  due(f: LifecycleFacts): string | null;
  build(f: LifecycleFacts, periodKey: string): Pick<MessagePlan, 'email' | 'push' | 'variants'>;
}

const hello = (f: LifecycleFacts) => (f.profile.firstName ? `Hi ${f.profile.firstName},` : 'Hi there,');

function subject(f: LifecycleFacts, key: string, named: Array<(name: string) => string>, anonymous: string[]): { text: string; id: string } {
  const name = f.profile.firstName.trim();
  if (name) {
    const i = named.indexOf(pick(named, f.profile.userId, `subject:${key}`));
    return { text: named[i](name), id: `s${i + 1}` };
  }
  const i = anonymous.indexOf(pick(anonymous, f.profile.userId, `subject:${key}`));
  return { text: anonymous[i], id: `a${i + 1}` };
}

const soloCircle = (f: LifecycleFacts): CircleFacts | null =>
  f.circles.find(
    (c) => c.memberCount === 1 && c.joinedAt !== null && Date.parse(c.joinedAt) <= Date.now() - 24 * 3_600_000
  ) ?? null;

const circleLink = (f: LifecycleFacts, c: CircleFacts): string | null =>
  c.inviteCode ? `https://www.fitcircle.ai/join/${encodeURIComponent(c.inviteCode)}${f.referral ? `?ref=${encodeURIComponent(f.referral.code)}` : ''}` : null;

function email(subjectText: string, preheader: string, greeting: string, blocks: ContentBlock[], footerReason: string): EmailContent {
  return { subject: subjectText, preheader, greeting, blocks, footerReason };
}

const JOINED = "You're getting this because you recently joined FitCircle.";
const MEMBER = "You're getting this because you have a FitCircle account.";

export const LIFECYCLE_STEPS: readonly LifecycleStep[] = [
  {
    key: 'onboarding_first_meal',
    channels: ['email'],
    goalKey: 'meal_logged',
    due: (f) => (f.mealsEver === 0 && f.accountAgeHours >= 20 && f.accountAgeHours < 96 ? 'once' : null),
    build: (f) => {
      const s = subject(
        f,
        'onboarding_first_meal',
        [(n) => `${n}, let's log your first meal`, () => 'Snap your first meal', () => 'Your first log takes seconds'],
        ['Snap your first meal', 'Your first log takes seconds']
      );
      return {
        variants: { subject: s.id },
        email: email(
          s.text,
          'Point, snap, done. FitCircle fills in the calories and macros.',
          hello(f),
          [
            {
              kind: 'hero',
              eyebrow: 'GETTING STARTED',
              title: 'Your first meal takes seconds',
              body: "Point your camera at whatever you're eating next. FitCircle estimates calories, protein, carbs and fat, and you can adjust anything before saving.",
            },
            {
              kind: 'list',
              title: 'How it works',
              items: [
                { title: 'Snap', detail: 'Take a photo of your plate, or describe it in a sentence.', accent: 'orange' },
                { title: 'Review', detail: 'Check the estimate and tweak portions if you need to.', accent: 'violet' },
                { title: 'Done', detail: 'Your day fills in and your streak starts.', accent: 'green' },
              ],
            },
            { kind: 'cta', cta: { id: 'primary', label: 'Snap my first meal', url: appScreenUrl('food_log') }, note: 'Prefer typing? Search the food database instead.' },
          ],
          JOINED
        ),
      };
    },
  },
  {
    key: 'onboarding_first_circle',
    channels: ['email', 'push'],
    goalKey: 'circle_joined',
    due: (f) =>
      f.mealsEver >= 1 && f.circles.length === 0 && f.accountAgeHours >= 44 && f.accountAgeHours < 14 * 24 ? 'once' : null,
    build: (f) => {
      const s = subject(
        f,
        'onboarding_first_circle',
        [(n) => `${n}, who's in your circle?`, () => 'Fitness is easier with friends', () => 'Start a circle in a minute'],
        ['Fitness is easier with friends', 'Start a circle in a minute']
      );
      const push: PushContent = {
        title: 'Better with friends',
        body: 'Start a circle and invite 2 or 3 friends to keep each other on track.',
        screen: 'circles',
      };
      return {
        variants: { subject: s.id },
        push,
        email: email(
          s.text,
          'A small private group that keeps each other going.',
          hello(f),
          [
            {
              kind: 'hero',
              eyebrow: 'NEXT STEP',
              title: 'Bring 2 or 3 friends along',
              body: "You've started logging. Nice! A circle is a small private group that sees each other's check-ins, keeps a shared streak alive and cheers each other on.",
            },
            {
              kind: 'list',
              items: [
                { title: 'Start a circle', detail: 'Name it and pick a goal. It takes a minute.', accent: 'violet' },
                { title: 'Share the link', detail: 'Send it by text or any chat app. Friends join in one tap.', accent: 'pink' },
                { title: 'Keep each other going', detail: "Everyone's check-ins show up in your circle's chat.", accent: 'green' },
              ],
            },
            { kind: 'cta', cta: { id: 'primary', label: 'Start my circle', url: appScreenUrl('circles') } },
          ],
          JOINED
        ),
      };
    },
  },
  {
    key: 'onboarding_invite_friend',
    channels: ['email', 'push'],
    goalKey: 'invite_sent',
    due: (f) => {
      const c = soloCircle(f);
      return c && f.accountAgeHours < 21 * 24 ? `circle:${c.id}` : null;
    },
    build: (f) => {
      const c = soloCircle(f)!;
      const link = circleLink(f, c);
      const s = subject(
        f,
        'onboarding_invite_friend',
        [() => `${c.name} is ready for friends`, (n) => `${n}, invite someone to ${c.name}`, () => 'Your circle has room for friends'],
        [`${c.name} is ready for friends`, 'Your circle has room for friends']
      );
      const reward =
        f.referral && f.referral.rewardDays > 0
          ? ` When a friend joins and checks in on ${f.referral.qualifyingDays} days, you both get ${f.referral.rewardDays} days of Pro.`
          : '';
      return {
        variants: { subject: s.id },
        push: { title: `${c.name} has room for friends`, body: "It's just you so far. Share your circle link and keep each other on track.", screen: 'invite_hub' },
        email: email(
          s.text,
          "It's just you so far. Share your link and fill a seat.",
          hello(f),
          [
            {
              kind: 'hero',
              eyebrow: 'YOUR CIRCLE',
              title: `${c.name} is ready for friends`,
              body: `Right now it's just you. Circles work best with a few people who check in on each other.${reward}`,
            },
            ...(link ? [{ kind: 'text' as const, body: `Share your circle link by text or any chat app: ${link.replace(/^https:\/\//, '')}` }] : []),
            { kind: 'cta', cta: { id: 'primary', label: 'Invite friends', url: appScreenUrl('invite_hub') } },
          ],
          JOINED
        ),
      };
    },
  },
  {
    key: 'celebrate_streak',
    channels: ['email'],
    goalKey: 'active',
    due: (f) => {
      const n = f.streak.current;
      const last = f.streak.lastEngagementDate;
      if (!last || !(STREAK_MILESTONES as readonly number[]).includes(n)) return null;
      if (last !== f.today && last !== addDays(f.today, -1)) return null;
      return `streak:${n}:${addDays(last, -(n - 1))}`;
    },
    build: (f) => {
      const n = f.streak.current;
      const body: Record<number, string> = {
        7: 'A full week of showing up. That is how habits start.',
        30: 'A whole month, every single day. This is who you are now.',
        100: 'One hundred days in a row. Rare, and entirely yours.',
        365: 'A full year, every single day. Remarkable.',
      };
      const s = subject(
        f,
        `celebrate_streak:${n}`,
        [() => `${n} days in a row!`, (name) => `${name}, ${n}-day streak unlocked`, () => `You've built a ${n}-day habit`],
        [`${n} days in a row!`, `You've built a ${n}-day habit`]
      );
      return {
        variants: { subject: s.id, milestone: String(n) },
        email: email(
          s.text,
          `${n} days in a row. Here's to the next ${n}.`,
          hello(f),
          [
            { kind: 'hero', eyebrow: 'STREAK MILESTONE', title: `${n} days in a row`, body: body[n] ?? 'Day after day. Keep going.' },
            { kind: 'text', body: 'Busy day coming up? Streak shields cover a missed day for you, so one off day never erases your progress.' },
            { kind: 'cta', cta: { id: 'primary', label: 'See my streak', url: appScreenUrl('streaks') } },
          ],
          MEMBER
        ),
      };
    },
  },
  {
    key: 'reengage_comeback',
    channels: ['email', 'push'],
    goalKey: 'active',
    cooldownDays: 14,
    due: (f) => {
      if (!f.lastActiveDate) return null;
      const away = daysBetween(f.lastActiveDate, f.today);
      return away >= 3 && away <= 6 ? `lapse:${f.lastActiveDate}` : null;
    },
    build: (f) => {
      const s = subject(
        f,
        'reengage_comeback',
        [(n) => `${n}, one small log restarts everything`, () => 'Pick up where you left off', () => 'We saved your spot'],
        ['Pick up where you left off', 'We saved your spot']
      );
      const circle = f.circles.find((c) => !c.upcoming && c.memberCount > 1);
      return {
        variants: { subject: s.id },
        push: { title: 'Pick up where you left off', body: 'One logged meal or a quick check-in is all it takes today.', screen: 'food_log' },
        email: email(
          s.text,
          "No perfect day needed. One small log and you're back.",
          hello(f),
          [
            {
              kind: 'hero',
              eyebrow: 'WELCOME BACK',
              title: 'One small log gets you going again',
              body: "It's been a few days, and that is completely normal. You don't need a perfect day, just one logged meal or a quick check-in.",
            },
            ...(circle ? [{ kind: 'text' as const, body: `${circle.name} is still going. A quick hello in the circle chat counts too.` }] : []),
            { kind: 'cta', cta: { id: 'primary', label: 'Log something small', url: appScreenUrl('food_log') } },
          ],
          MEMBER
        ),
      };
    },
  },
];

export type LifecycleDecision =
  | { step: LifecycleStep; periodKey: string; plan: MessagePlan }
  | { skip: 'cooldown' | 'cap' | 'already_sent'; key: MessageKey; periodKey: string }
  | null;

/**
 * The one lifecycle message due for this person right now (at most one per
 * run), honouring the per-period ledger history in `f.recentSends`, step
 * cooldowns, email spacing and the weekly email cap. Null = nothing due.
 */
export function selectLifecycleMessage(f: LifecycleFacts, now: Date = new Date()): LifecycleDecision {
  if (f.localHour < LIFECYCLE_SEND_HOURS.from || f.localHour > LIFECYCLE_SEND_HOURS.to) return null;
  const ms = (iso: string) => now.getTime() - Date.parse(iso);
  for (const step of LIFECYCLE_STEPS) {
    const periodKey = step.due(f);
    if (!periodKey) continue;
    const mine = f.recentSends.filter((s) => s.messageKey === step.key);
    if (mine.some((s) => s.periodKey === periodKey)) continue; // done for this period; try the next step
    if (step.cooldownDays && mine.some((s) => s.status === 'sent' && ms(s.at) < step.cooldownDays! * 86_400_000)) {
      return { skip: 'cooldown', key: step.key, periodKey };
    }
    if (step.channels.includes('email')) {
      const emails = f.recentSends.filter((s) => s.channel === 'email' && s.status === 'sent' && s.messageKey !== 'welcome');
      const lifecycleEmails = emails.filter((s) => s.messageKey !== 'weekly_report');
      if (lifecycleEmails.some((s) => ms(s.at) < LIFECYCLE_EMAIL_SPACING_HOURS * 3_600_000)) {
        return { skip: 'cooldown', key: step.key, periodKey };
      }
      if (emails.filter((s) => ms(s.at) < 7 * 86_400_000).length >= ENGAGEMENT_EMAILS_PER_WEEK) {
        return { skip: 'cap', key: step.key, periodKey };
      }
    }
    const built = step.build(f, periodKey);
    return {
      step,
      periodKey,
      plan: {
        messageKey: step.key,
        periodKey,
        medium: 'lifecycle',
        templateVersion: LIFECYCLE_TEMPLATE,
        variants: built.variants,
        goalKey: step.goalKey,
        email: step.channels.includes('email') ? built.email : undefined,
        push: step.channels.includes('push') ? built.push : undefined,
      },
    };
  }
  return null;
}
