/**
 * Campaign validation (docs/CAMPAIGNS_SPEC.md §2, §5–§7). The zod schema is
 * what POST/PATCH accept; publishIssues() is the stricter "ready to go live"
 * checklist; appStoreIssues() the App Store In-App Event rules.
 */
import { z } from 'zod';

import { ICON_KEYS } from '@/lib/design/icons';
import { addDays, daysBetween } from '@/lib/streaks/streak-calculator';

import { totalDaysOf } from './model';
import type { AdminCampaign, CampaignInput } from './types';

/** Length in user-perceived code points (emoji count once-ish, like Postgres char_length). */
const cp = (s: string) => [...s].length;
const text = (max: number) => z.string().refine((s) => cp(s) <= max, { message: `Must be at most ${max} characters` });
const required = (max: number) => text(max).refine((s) => s.trim().length > 0, { message: 'Required' });

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
export const isoDate = z
  .string()
  .regex(dateRe, 'Expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), {
    message: 'Invalid date',
  });
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb');

export const LIMITS = {
  title: 40,
  emoji: 8,
  tagline: 80,
  description: 280,
  ctaLabel: 24,
  pushTitle: 60,
  pushBody: 140,
  emailSubject: 80,
  emailPreheader: 100,
  emailHeading: 60,
  emailBody: 600,
  appStoreName: 30,
  appStoreShort: 50,
  appStoreLong: 120,
  appStoreEventDays: 31,
  appStorePromoLeadDays: 14,
  playTitle: 80,
  playDescription: 500,
  doorTitle: 40,
  doorTask: 140,
} as const;

export const TEMPLATES = ['seasonal_circle', 'daily_calendar', 'spotlight'] as const;
export const GLYPHS = ['snowflake', 'gift', 'year', 'sun', 'moon', 'flame', 'leaf', 'heart', 'star', 'bolt'] as const;
export const CTA_ACTIONS = ['start_circle', 'open_calendar', 'invite', 'paywall', 'circles', 'open_url'] as const;
export const APP_STORE_BADGES = [
  'CHALLENGE', 'COMPETITION', 'LIVE_EVENT', 'MAJOR_UPDATE', 'NEW_SEASON', 'PREMIERE', 'SPECIAL_EVENT',
] as const;
export const ART_SLOTS = ['appStoreCard', 'appStoreDetails', 'inAppHero', 'emailHeader'] as const;

const deliveryKey = z.string().regex(/^[a-z0-9_-]{1,40}$/, 'Key: lowercase letters, digits, _ or -');
const kind = z.enum(['launch', 'daily', 'last_day', 'custom']);

const notificationSchema = z
  .object({
    key: deliveryKey,
    kind,
    sendOn: isoDate.nullish(),
    localHour: z.number().int().min(0).max(23),
    title: required(LIMITS.pushTitle),
    body: required(LIMITS.pushBody),
    audience: z.enum(['all', 'participants', 'reminders']),
    enabled: z.boolean(),
  })
  .refine((n) => n.kind !== 'custom' || !!n.sendOn, { message: 'Custom messages need a send date', path: ['sendOn'] });

const emailSchema = z
  .object({
    key: deliveryKey,
    kind,
    sendOn: isoDate.nullish(),
    localHour: z.number().int().min(0).max(23),
    subject: required(LIMITS.emailSubject),
    preheader: text(LIMITS.emailPreheader),
    heading: required(LIMITS.emailHeading),
    body: required(LIMITS.emailBody),
    ctaLabel: required(LIMITS.ctaLabel),
    audience: z.enum(['all', 'participants']),
    enabled: z.boolean(),
  })
  .refine((n) => n.kind !== 'custom' || !!n.sendOn, { message: 'Custom emails need a send date', path: ['sendOn'] });

const circleSchema = z.object({
  name: required(60),
  description: text(500),
  type: z.enum(['custom', 'step_count', 'workout_minutes', 'weight_loss']),
  startDate: isoDate,
  endDate: isoDate,
});

/** An icon key (design/icons.json). Optional everywhere: readers derive one from `emoji`. */
const iconKey = z.enum(ICON_KEYS);

const doorSchema = z.object({
  day: z.number().int().min(1).max(366),
  emoji: required(LIMITS.emoji),
  icon: iconKey.optional(),
  title: required(LIMITS.doorTitle),
  task: required(LIMITS.doorTask),
});

const appStoreSchema = z
  .object({
    name: text(LIMITS.appStoreName).optional(),
    shortDescription: text(LIMITS.appStoreShort).optional(),
    longDescription: text(LIMITS.appStoreLong).optional(),
    badge: z.enum(APP_STORE_BADGES).optional(),
    purpose: z
      .enum(['APPROPRIATE_FOR_ALL_USERS', 'ATTRACT_NEW_USERS', 'KEEP_ACTIVE_USERS_INFORMED', 'BRING_BACK_LAPSED_USERS'])
      .optional(),
    priority: z.enum(['HIGH', 'NORMAL']).optional(),
  })
  .passthrough();

export const campaignInputSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9_]{3,40}$/, 'Slug: 3–40 lowercase letters, digits or _'),
    template: z.enum(TEMPLATES),
    title: required(LIMITS.title),
    emoji: text(LIMITS.emoji),
    icon: iconKey.nullish(),
    tagline: text(LIMITS.tagline),
    description: text(LIMITS.description),
    ctaLabel: text(LIMITS.ctaLabel).nullish(),
    accent: hex,
    palette: z.tuple([hex, hex, hex]),
    glyph: z.enum(GLYPHS),
    featuredFrom: isoDate,
    startsAt: isoDate,
    endsAt: isoDate,
    priority: z.number().int().min(-100).max(100).default(0),
    cta: z.object({ action: z.enum(CTA_ACTIONS), url: z.string().url().max(500).nullish() }),
    circle: circleSchema.nullable().default(null),
    calendar: z.object({ doors: z.array(doorSchema).max(62) }).nullable().default(null),
    marks: z.array(z.object({ date: isoDate, emoji: required(LIMITS.emoji), icon: iconKey.optional(), label: text(40) })).max(20).default([]),
    notifications: z.array(notificationSchema).max(20).default([]),
    emails: z.array(emailSchema).max(10).default([]),
    appStore: appStoreSchema.default({}),
    play: z
      .object({
        title: text(LIMITS.playTitle).optional(),
        description: text(LIMITS.playDescription).optional(),
        exportedAt: z.string().nullish(),
      })
      .default({}),
  })
  .superRefine((c, ctx) => {
    if (!(c.featuredFrom <= c.startsAt)) ctx.addIssue({ code: 'custom', path: ['featuredFrom'], message: 'Featured from must be on or before the start' });
    if (!(c.startsAt <= c.endsAt)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be on or after the start' });
    if (daysBetween(c.startsAt, c.endsAt) > 365) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'At most one year long' });
    if (c.cta.action === 'open_url' && !(c.cta.url && /^https:\/\//.test(c.cta.url))) {
      ctx.addIssue({ code: 'custom', path: ['cta', 'url'], message: 'An https URL is required for open_url' });
    }
    if (c.circle && c.circle.startDate > c.circle.endDate) {
      ctx.addIssue({ code: 'custom', path: ['circle', 'endDate'], message: 'Circle end must be on or after its start' });
    }
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);
    for (const k of dupes(c.notifications.map((n) => n.key))) ctx.addIssue({ code: 'custom', path: ['notifications'], message: `Duplicate key "${k}"` });
    for (const k of dupes(c.emails.map((n) => n.key))) ctx.addIssue({ code: 'custom', path: ['emails'], message: `Duplicate key "${k}"` });
    if (c.calendar) {
      const days = c.calendar.doors.map((d) => d.day);
      for (const d of dupes(days.map(String))) ctx.addIssue({ code: 'custom', path: ['calendar', 'doors'], message: `Door ${d} appears twice` });
    }
  });

export type ParsedCampaignInput = z.infer<typeof campaignInputSchema>;

export function parseCampaignInput(body: unknown): CampaignInput {
  return campaignInputSchema.parse(body) as CampaignInput;
}

/** Body of PATCH: any subset of CampaignInput plus the version being edited. */
export const patchSchema = z.object({ version: z.number().int().min(1) }).passthrough();

/** What still blocks publishing (empty = ready). */
export function publishIssues(c: AdminCampaign, opts: { acceptFallbackArt?: boolean } = {}): string[] {
  const issues: string[] = [];
  if (!c.title.trim()) issues.push('Title is required');
  if (!c.tagline.trim()) issues.push('Tagline is required');
  if (!c.description.trim()) issues.push('Description is required');
  if (!c.emoji.trim()) issues.push('Emoji is required');
  if (!(c.featuredFrom <= c.startsAt && c.startsAt <= c.endsAt)) issues.push('Dates must be featured ≤ start ≤ end');
  if (c.template === 'seasonal_circle' && !c.circle) issues.push('A circle template is required for seasonal circles');
  if (c.template === 'daily_calendar') {
    const total = totalDaysOf({ starts_at: c.startsAt, ends_at: c.endsAt });
    const have = new Set((c.calendar?.doors ?? []).map((d) => d.day));
    const missing: number[] = [];
    for (let d = 1; d <= total; d++) if (!have.has(d)) missing.push(d);
    if (missing.length) issues.push(`Calendar is missing door${missing.length > 1 ? 's' : ''} ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
    if ((c.calendar?.doors ?? []).some((d) => d.day > total)) issues.push(`Calendar has doors past day ${total}`);
  }
  if (c.template === 'spotlight' && c.cta.action === 'open_url' && !c.cta.url) issues.push('Spotlight URL is required');
  if (c.template === 'spotlight' && c.cta.action === 'open_calendar') issues.push('Spotlight cannot open a calendar');
  if (!c.art?.inAppHero?.url && !opts.acceptFallbackArt) issues.push('Add in-app hero art or accept the gradient fallback');
  return issues;
}

/** App Store event dates (absolute instants; days start at midnight Pacific). */
export function appStoreSchedule(c: { featuredFrom: string; startsAt: string; endsAt: string }) {
  const promoFloor = addDays(c.startsAt, -LIMITS.appStorePromoLeadDays);
  const publishDay = c.featuredFrom > promoFloor ? c.featuredFrom : promoFloor;
  // 08:00Z = 00:00 PST. End = the last day's 23:59 PST.
  return {
    publishStart: `${publishDay}T08:00:00.000Z`,
    eventStart: `${c.startsAt}T08:00:00.000Z`,
    eventEnd: `${addDays(c.endsAt, 1)}T07:59:00.000Z`,
  };
}

/** App Store In-App Event rules (§7). Empty = can sync. */
export function appStoreIssues(c: AdminCampaign): string[] {
  const issues: string[] = [];
  const a = c.appStore ?? {};
  if (!a.name?.trim()) issues.push('App Store event name is required');
  else if (cp(a.name) > LIMITS.appStoreName) issues.push(`Event name must be ≤ ${LIMITS.appStoreName} characters`);
  if (!a.shortDescription?.trim()) issues.push('Short description is required');
  else if (cp(a.shortDescription) > LIMITS.appStoreShort) issues.push(`Short description must be ≤ ${LIMITS.appStoreShort} characters`);
  if (!a.longDescription?.trim()) issues.push('Long description is required');
  else if (cp(a.longDescription) > LIMITS.appStoreLong) issues.push(`Long description must be ≤ ${LIMITS.appStoreLong} characters`);
  if (!a.badge) issues.push('Badge is required');
  const days = daysBetween(c.startsAt, c.endsAt) + 1;
  if (days > LIMITS.appStoreEventDays) issues.push(`App Store events can run at most ${LIMITS.appStoreEventDays} days (this one is ${days})`);
  return issues;
}
