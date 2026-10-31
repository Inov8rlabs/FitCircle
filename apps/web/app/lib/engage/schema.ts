/**
 * Engage validation (docs/ENGAGE_SPEC.md §4–§7, §15).
 *  - messageInputSchema: what create/PATCH accept (structure + character limits).
 *  - launchCheck(): the go-live checklist — weights, layout/placement/channel
 *    compatibility, platform capability rules, required content. Errors block
 *    launch; warnings are shown inline.
 */
import { z } from 'zod';

import { ATTRIBUTE_KEYS } from './attributes';
import { PLATFORMS } from './platform';
import type { AttributeKey, EngageMessage, MessageContent, PushContent, EmailContent, EngageAction } from './types';

const cp = (s: string) => [...s].length;
const text = (max: number) => z.string().refine((s) => cp(s) <= max, { message: `Must be at most ${max} characters` });
const hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Expected #rrggbb');

export const ENGAGE_LIMITS = {
  title: 60,
  body: 240,
  badge: 20,
  buttonLabel: 24,
  buttons: 2,
  pushTitle: 60,
  pushBody: 140,
  emailSubject: 80,
  emailPreheader: 100,
  emailHeading: 60,
  emailBody: 600,
  emailCta: 24,
  name: 120,
} as const;

export const CHANNELS = ['content_card', 'in_app', 'push', 'email'] as const;
export const PLACEMENTS = ['home_hero', 'home_feed', 'circles_top', 'profile_top', 'post_checkin'] as const;
export const CARD_LAYOUTS = ['hero', 'card', 'banner', 'captioned_image', 'image_only'] as const;
export const IN_APP_LAYOUTS = ['modal', 'slideup', 'fullscreen'] as const;
export const ACTION_TYPES = ['deeplink', 'url', 'invite', 'paywall', 'start_circle', 'campaign', 'screen', 'dismiss'] as const;
export const APP_EVENTS = [
  'app_open', 'screen_view', 'check_in_completed', 'streak_milestone', 'circle_created',
  'circle_joined', 'invite_sent', 'subscription_started', 'door_opened', 'workout_logged', 'meal_logged',
] as const;
export const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'exists', 'not_exists'] as const;

const scalar = z.union([z.string().max(200), z.number(), z.boolean()]);
export const filterSchema = z.object({
  key: z.enum(ATTRIBUTE_KEYS as unknown as [AttributeKey, ...AttributeKey[]]),
  op: z.enum(FILTER_OPS),
  value: z.union([scalar, z.array(z.union([z.string().max(200), z.number()])).max(100)]).nullish(),
});
export const filtersSchema = z.array(filterSchema).max(30);

const actionSchema = z.object({ type: z.enum(ACTION_TYPES), value: z.string().max(500).nullish() });
const imageRef = z.object({ assetId: z.string().uuid() }).nullish();

// Per-channel content (full) — overrides use .partial() of the same.
const cardContent = z.object({
  image: imageRef,
  imageAlt: text(200).nullish(),
  title: text(ENGAGE_LIMITS.title),
  body: text(ENGAGE_LIMITS.body),
  badge: text(ENGAGE_LIMITS.badge).nullish(),
  buttons: z
    .array(z.object({ label: text(ENGAGE_LIMITS.buttonLabel), action: actionSchema, style: z.enum(['primary', 'secondary']).default('primary') }))
    .max(ENGAGE_LIMITS.buttons)
    .default([]),
  theme: z
    .object({ background: hex.optional(), text: hex.optional(), accent: hex.optional(), buttonBackground: hex.optional(), buttonText: hex.optional() })
    .default({}),
  imageFit: z.enum(['cover', 'contain']).default('cover'),
  dismissible: z.boolean().default(true),
  pinned: z.boolean().default(false),
});
const pushContent = z.object({ title: text(ENGAGE_LIMITS.pushTitle), body: text(ENGAGE_LIMITS.pushBody), image: imageRef, action: actionSchema });
const emailContent = z.object({
  subject: text(ENGAGE_LIMITS.emailSubject),
  preheader: text(ENGAGE_LIMITS.emailPreheader).default(''),
  heading: text(ENGAGE_LIMITS.emailHeading),
  body: text(ENGAGE_LIMITS.emailBody),
  image: imageRef,
  ctaLabel: text(ENGAGE_LIMITS.emailCta),
  action: actionSchema,
});

export const CONTENT_SCHEMA = { content_card: cardContent, in_app: cardContent, push: pushContent, email: emailContent } as const;

const triggerSchema = z.object({
  event: z.enum(APP_EVENTS),
  filters: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']),
        value: z.union([scalar, z.array(z.union([z.string().max(200), z.number()])).max(50)]),
      })
    )
    .max(10)
    .optional(),
  delaySeconds: z.number().int().min(0).max(30).default(0),
});

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Expected an ISO timestamp');

export const messageInputSchema = z
  .object({
    name: z.string().min(1).max(ENGAGE_LIMITS.name),
    campaignId: z.string().uuid().nullable().default(null),
    channel: z.enum(CHANNELS),
    placement: z.enum(PLACEMENTS).nullable().default(null),
    layout: z.enum([...CARD_LAYOUTS, ...IN_APP_LAYOUTS]).nullable().default(null),
    variants: z
      .array(
        z.object({
          id: z.string().regex(/^[A-Z]$/, 'Variant ids are single capital letters'),
          name: z.string().max(60).default(''),
          weight: z.number().int().min(0).max(100),
          content: z.record(z.any()),
          platformOverrides: z.record(z.enum(['ios', 'android', 'web']), z.record(z.any())).optional(),
        })
      )
      .min(1)
      .max(5),
    controlWeight: z.number().int().min(0).max(50).default(0),
    segmentId: z.string().uuid().nullable().default(null),
    audienceFilters: filtersSchema.default([]),
    platforms: z.array(z.enum(['ios', 'android', 'web'])).max(3).default([]),
    startsAt: iso,
    endsAt: iso.nullable().default(null),
    sendMode: z.enum(['immediate', 'scheduled', 'local_time']).nullable().default(null),
    sendAt: iso.nullable().default(null),
    localHour: z.number().int().min(0).max(23).nullable().default(null),
    trigger: triggerSchema.nullable().default(null),
    maxImpressionsPerUser: z.number().int().min(1).max(1000).nullable().default(null),
    minHoursBetween: z.number().int().min(0).max(24 * 90).nullable().default(null),
    priority: z.number().int().min(-1000).max(1000).default(0),
    respectGlobalCap: z.boolean().default(true),
    conversion: z
      .object({ event: z.enum(APP_EVENTS), windowHours: z.number().int().min(1).max(168), basis: z.enum(['click', 'impression']) })
      .nullable()
      .default(null),
  })
  .superRefine((m, ctx) => {
    const schema = CONTENT_SCHEMA[m.channel];
    m.variants.forEach((v, i) => {
      const full = schema.safeParse(v.content);
      if (!full.success) for (const issue of full.error.issues) ctx.addIssue({ ...issue, path: ['variants', i, 'content', ...issue.path] });
      else v.content = full.data as Record<string, unknown>;
      for (const [p, o] of Object.entries(v.platformOverrides ?? {})) {
        const part = (schema as z.AnyZodObject).partial().safeParse(o);
        if (!part.success) for (const issue of part.error.issues) ctx.addIssue({ ...issue, path: ['variants', i, 'platformOverrides', p, ...issue.path] });
      }
    });
    const ids = m.variants.map((v) => v.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Variant ids must be unique' });
    if (m.endsAt && Date.parse(m.endsAt) <= Date.parse(m.startsAt)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be after start' });
  });

export function parseMessageInput(body: unknown) {
  return messageInputSchema.parse(body);
}

export const segmentInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  filters: filtersSchema.default([]),
});

export const eventBatchSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(['impression', 'click', 'dismiss', 'push_open', 'app_event']),
        messageId: z.string().uuid().nullish(),
        variantId: z.string().max(20).nullish(),
        buttonIndex: z.number().int().min(0).max(5).nullish(),
        name: z.enum(APP_EVENTS).nullish(),
        props: z.record(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
        at: iso,
      })
    )
    .max(50),
});

// ---------------------------------------------------------------- launch checklist

export interface LaunchCheck {
  errors: string[];
  warnings: string[];
}

function actionIssue(a: EngageAction | undefined, where: string): string | null {
  if (!a) return `${where}: action is required`;
  if (a.type === 'url' && !(a.value && /^https:\/\//.test(a.value))) return `${where}: URL actions need an https URL`;
  if ((a.type === 'deeplink' || a.type === 'screen' || a.type === 'campaign') && !a.value) return `${where}: ${a.type} actions need a value`;
  return null;
}

/**
 * Go-live checklist. `assetsOk(id)` says whether an asset exists and isn't
 * archived; `segmentOk(id)` likewise for segments.
 */
export function launchCheck(
  m: Pick<EngageMessage, 'channel' | 'placement' | 'layout' | 'variants' | 'controlWeight' | 'platforms' | 'startsAt' | 'endsAt' | 'sendMode' | 'sendAt' | 'localHour' | 'trigger' | 'conversion'>,
  opts: { assetsOk?: (id: string) => boolean; segmentOk?: boolean } = {}
): LaunchCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const total = m.variants.reduce((s, v) => s + (v.weight ?? 0), 0) + (m.controlWeight ?? 0);
  if (m.variants.length === 0) errors.push('Add at least one variant');
  if (total !== 100) errors.push(`Variant weights + control must add up to 100 (now ${total})`);
  if (m.controlWeight > 50) errors.push('Control can be at most 50%');
  if (m.endsAt && Date.parse(m.endsAt) < Date.now()) errors.push('The end date is in the past');

  const platforms = m.platforms ?? [];
  switch (m.channel) {
    case 'content_card': {
      if (!m.placement) errors.push('Pick a placement');
      if (!m.layout || !(CARD_LAYOUTS as readonly string[]).includes(m.layout)) errors.push('Pick a content card layout');
      if (m.placement === 'post_checkin' && m.layout && m.layout !== 'banner') errors.push('post_checkin shows one compact card: use the banner layout');
      if (m.layout === 'hero' && m.placement && m.placement !== 'home_hero' && m.placement !== 'home_feed') warnings.push('The hero layout is designed for home placements');
      if ((m.placement === 'circles_top') && m.layout && m.layout !== 'banner') warnings.push('Banner layouts are recommended for circles_top');
      if (m.trigger) warnings.push('Triggers only apply to in-app messages (ignored)');
      break;
    }
    case 'in_app': {
      if (!m.layout || !(IN_APP_LAYOUTS as readonly string[]).includes(m.layout)) errors.push('Pick an in-app layout (modal, slideup or fullscreen)');
      if (!m.trigger) errors.push('In-app messages need a trigger');
      if (m.placement) warnings.push('Placements only apply to content cards (ignored)');
      if (platforms.includes('web')) warnings.push('On web, in-app messages render as overlays');
      break;
    }
    case 'push': {
      if (platforms.length > 0 && platforms.every((p) => p === 'web')) errors.push('Push can only reach iOS and Android (web push is not supported)');
      else if (platforms.includes('web') || platforms.length === 0) warnings.push('Web has no push: web users are excluded');
      break;
    }
    case 'email':
      break;
  }
  if (m.channel === 'push' || m.channel === 'email') {
    if (!m.sendMode) errors.push('Pick a send mode');
    if ((m.sendMode === 'scheduled' || m.sendMode === 'local_time') && !m.sendAt) errors.push('Pick a send date');
    if (m.sendMode === 'local_time' && (m.localHour === null || m.localHour === undefined)) errors.push('Pick the local send hour');
  }
  for (const p of platforms) if (!(PLATFORMS as readonly string[]).includes(p)) errors.push(`Unknown platform "${p}"`);

  m.variants.forEach((v) => {
    const where = `Variant ${v.id}`;
    const parts: Array<[string, any]> = [[where, v.content], ...Object.entries(v.platformOverrides ?? {}).map(([p, o]) => [`${where} (${p})`, o] as [string, any])];
    if (m.channel === 'content_card' || m.channel === 'in_app') {
      const c = v.content as MessageContent;
      if (!c?.title?.trim() && m.layout !== 'image_only') errors.push(`${where}: title is required`);
      if ((m.layout === 'image_only' || m.layout === 'captioned_image' || m.layout === 'hero') && !c?.image?.assetId) errors.push(`${where}: the ${m.layout} layout needs an image`);
      if (m.layout === 'image_only' && !(c?.buttons?.length)) errors.push(`${where}: image_only cards need a button action (the whole card is tappable)`);
      for (const [label, part] of parts) (part?.buttons ?? []).forEach((b: any, i: number) => {
        const issue = actionIssue(b?.action, `${label} button ${i + 1}`);
        if (issue) errors.push(issue);
      });
    } else if (m.channel === 'push') {
      const c = v.content as PushContent;
      if (!c?.title?.trim() || !c?.body?.trim()) errors.push(`${where}: push title and body are required`);
      for (const [label, part] of parts) if (part?.action) {
        const issue = actionIssue(part.action, label);
        if (issue) errors.push(issue);
      }
    } else {
      const c = v.content as EmailContent;
      if (!c?.subject?.trim() || !c?.heading?.trim() || !c?.body?.trim() || !c?.ctaLabel?.trim()) errors.push(`${where}: subject, heading, body and button label are required`);
      for (const [label, part] of parts) if (part?.action) {
        const issue = actionIssue(part.action, label);
        if (issue) errors.push(issue);
      }
    }
    for (const [label, part] of parts) {
      const id = part?.image?.assetId;
      if (id && opts.assetsOk && !opts.assetsOk(id)) errors.push(`${label}: image asset is missing or archived`);
    }
  });
  if (opts.segmentOk === false) errors.push('The selected segment no longer exists');
  return { errors, warnings };
}
