/**
 * Action registry v1 (PROMO_CARD_SPEC §4, ACTIVATION_JOURNEY_SPEC §8): the
 * finite set of things a promo button may do, a zod schema per type, the
 * client `actions=` parser and the per-request fallback resolution.
 *
 * Safety: no arbitrary deep links (open_screen is an allowlist), open_url is
 * https + host allowlist, invalid params → unsupported → fallback. Clients
 * never receive an action they did not declare.
 */
import { z } from 'zod';

import { MEAL_SLOTS } from '../journey/meal-slots';

import { PROMO_LAYOUTS, type PromoAction, type PromoClientSupport, type PromoLayout, type WireAction } from './types';

export const ACTION_TYPES = [
  'open_screen',
  'paywall',
  'invite',
  'start_circle',
  'join_campaign',
  'log_water',
  'enable_notifications',
  'open_url',
  'dismiss',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** open_screen@1 screens. Adding one bumps the action to open_screen@2. */
export const OPEN_SCREENS_V1 = [
  'campaign',
  'calendar',
  'circles',
  'circle',
  'fitzy',
  'food_log',
  'log_meal',
  'hydration',
  'step_history',
  'profile',
  'settings_notifications',
  'health_connect',
] as const;

/** open_url hosts (PROMO_CARD_SPEC §4 / §14.3: allowlist only). */
export const OPEN_URL_HOSTS = ['fitcircle.ai', 'www.fitcircle.ai', 'apps.apple.com', 'play.google.com'] as const;

const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i);
const placement = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

const openScreen = z
  .discriminatedUnion('screen', [
    z.object({ screen: z.literal('campaign'), slug }).strict(),
    z.object({ screen: z.literal('calendar'), slug }).strict(),
    z.object({ screen: z.literal('circles') }).strict(),
    z.object({ screen: z.literal('circle'), id: z.string().uuid() }).strict(),
    z.object({ screen: z.literal('fitzy'), prompt: z.string().min(1).max(200).optional() }).strict(),
    z.object({ screen: z.literal('food_log') }).strict(),
    z.object({ screen: z.literal('log_meal'), meal: z.enum(MEAL_SLOTS).optional() }).strict(),
    z.object({ screen: z.literal('hydration') }).strict(),
    z.object({ screen: z.literal('step_history') }).strict(),
    z.object({ screen: z.literal('profile') }).strict(),
    z.object({ screen: z.literal('settings_notifications') }).strict(),
    z.object({ screen: z.literal('health_connect') }).strict(),
  ]);

const httpsAllowlisted = z
  .string()
  .max(1024)
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && (OPEN_URL_HOSTS as readonly string[]).includes(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'url must be https on an allowlisted host');

export const ACTION_PARAM_SCHEMAS: Record<ActionType, z.ZodTypeAny> = {
  open_screen: openScreen,
  paywall: z
    .object({
      placement,
      plan: z.enum(['annual', 'monthly', 'lifetime']).optional(),
      offering: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional(),
    })
    .strict(),
  invite: z.object({ source: z.literal('promo'), campaign: slug.optional() }).strict(),
  start_circle: z.object({ campaign: slug.optional(), type: z.string().regex(/^[a-z_]{1,40}$/).optional() }).strict(),
  join_campaign: z.object({ campaign: slug, reminders: z.boolean().optional() }).strict(),
  log_water: z.object({ ml: z.number().int().min(100).max(1000) }).strict(),
  enable_notifications: z.object({ category: z.string().regex(/^[a-z_]{1,40}$/).optional() }).strict(),
  open_url: z.object({ url: httpsAllowlisted, mode: z.enum(['in_app', 'external']) }).strict(),
  dismiss: z.object({}).strict(),
};

export function isActionType(t: string): t is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(t);
}

/** Validate one action's params (no fallback, no client check). Returns the parsed params or null. */
export function validateActionParams(type: string, params: unknown): Record<string, unknown> | null {
  if (!isActionType(type)) return null;
  const parsed = ACTION_PARAM_SCHEMAS[type].safeParse(params ?? {});
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

const MAX_TOKENS = 32;
const TOKEN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * `actions=open_screen@1,paywall@1,…` → type → highest version. Lenient like
 * `cards=` (bare type = @1, junk ignored). Missing/empty → only `dismiss@1`
 * (PROMO_CARD_SPEC §6.1), so no promo with a primary button is sent.
 */
export function parseClientActions(raw: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (raw) {
    for (const token of raw.split(',').slice(0, MAX_TOKENS)) {
      const t = token.trim();
      if (!t) continue;
      const [type, v, ...rest] = t.split('@');
      if (rest.length || !TOKEN.test(type)) continue;
      let version = 1;
      if (v !== undefined) {
        if (!/^\d{1,3}$/.test(v)) continue;
        version = Number(v);
      }
      if (version < 1) continue;
      out.set(type, Math.max(out.get(type) ?? 0, version));
    }
  }
  if (out.size === 0) out.set('dismiss', 1);
  return out;
}

/** `promoLayouts=hero,banner,compact` → known layouts. Missing → none (no promo can render). */
export function parsePromoLayouts(raw: string | null | undefined): Set<PromoLayout> {
  const out = new Set<PromoLayout>();
  for (const t of (raw ?? '').split(',').slice(0, 8)) {
    const v = t.trim().toLowerCase();
    if ((PROMO_LAYOUTS as readonly string[]).includes(v)) out.add(v as PromoLayout);
  }
  return out;
}

export function parsePromoClient(params: { cardsSupportPromo: boolean; actions: string | null; promoLayouts: string | null }): PromoClientSupport {
  return {
    promoCard: params.cardsSupportPromo,
    actions: parseClientActions(params.actions),
    layouts: parsePromoLayouts(params.promoLayouts),
  };
}

const MAX_FALLBACK_DEPTH = 4;

/**
 * Resolve an action for this client: the action itself, else the first
 * fallback (depth-first, in order) the client declares at a sufficient
 * version AND whose params validate. Null → the button is dropped.
 */
export function resolveAction(action: PromoAction, actions: Map<string, number>, depth = 0): WireAction | null {
  if (depth > MAX_FALLBACK_DEPTH) return null;
  const declared = actions.get(action.type);
  if (declared !== undefined && declared >= (action.version ?? 1)) {
    const params = validateActionParams(action.type, action.params);
    if (params) return { type: action.type, params };
  }
  for (const fb of action.fallback ?? []) {
    const r = resolveAction(fb, actions, depth + 1);
    if (r) return r;
  }
  return null;
}
