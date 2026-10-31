/**
 * Pure content helpers shared by the Engage composer preview and the web
 * renderer (ENGAGE_SPEC §4, §5, §15): platform override merge, personalisation,
 * asset expansion, variant weight validation and authoring defaults.
 */

import type {
  AssetRef,
  CardLayout,
  EmailContent,
  EngageAsset,
  EngageChannel,
  EngageLayout,
  EngagePlatform,
  EngageTheme,
  InAppLayout,
  MessageContent,
  MessageInput,
  MessageVariant,
  Placement,
  PlatformOverrides,
  PushContent,
  RenderedContent,
} from '../types';

export const PLATFORMS: readonly EngagePlatform[] = ['ios', 'android', 'web'];
export const PLATFORM_LABEL: Record<EngagePlatform, string> = { ios: 'iOS', android: 'Android', web: 'Web' };

export const CARD_LAYOUTS: readonly CardLayout[] = ['hero', 'card', 'banner', 'captioned_image', 'image_only'];
export const IAM_LAYOUTS: readonly InAppLayout[] = ['modal', 'slideup', 'fullscreen'];
export const PLACEMENTS: readonly Placement[] = ['home_hero', 'home_feed', 'circles_top', 'profile_top', 'post_checkin'];

export const LAYOUT_LABEL: Record<EngageLayout, string> = {
  hero: 'Hero',
  card: 'Card',
  banner: 'Banner',
  captioned_image: 'Captioned image',
  image_only: 'Image only',
  modal: 'Modal',
  slideup: 'Slide-up',
  fullscreen: 'Full screen',
};

export const PLACEMENT_LABEL: Record<Placement, string> = {
  home_hero: 'Home · hero',
  home_feed: 'Home · feed',
  circles_top: 'Circles · top',
  profile_top: 'Profile · top',
  post_checkin: 'Check-in celebration',
};

/** Recommended layout per placement (§3). */
export const PLACEMENT_DEFAULT_LAYOUT: Record<Placement, CardLayout> = {
  home_hero: 'hero',
  home_feed: 'card',
  circles_top: 'banner',
  profile_top: 'card',
  post_checkin: 'banner',
};

/**
 * image_only aspect rule (mirrors the apps): the image keeps its own aspect ratio,
 * never taller than 4:5 — except in `profile_top`, where it is capped at 16:9
 * (width / height ≥ 16/9, cropped "cover") so a promo never dominates the Profile tab.
 */
export const IMAGE_ONLY_MIN_ASPECT: Record<'default' | 'profile_top', number> = { default: 4 / 5, profile_top: 16 / 9 };

export const CHANNEL_LABEL: Record<EngageChannel, string> = {
  content_card: 'Content Card',
  in_app: 'In-App',
  push: 'Push',
  email: 'Email',
};

export const CONTENT_LIMITS = { title: 60, body: 240, badge: 20, buttonLabel: 24, pushTitle: 60, pushBody: 140, subject: 80, preheader: 100, heading: 60, emailBody: 600 } as const;

// ---------------------------------------------------------------------------
// Platform overrides (§15)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Merges the caller's platform override over the base content. Objects such as
 * `theme` merge key by key; arrays (`buttons`) and scalars replace; `undefined`
 * keeps the base value, `null` clears it.
 */
export function applyPlatformOverride<C extends object>(content: C, overrides: PlatformOverrides<C> | undefined | null, platform: EngagePlatform): C {
  const o = overrides?.[platform];
  if (!o) return content;
  const out: Record<string, unknown> = { ...(content as Record<string, unknown>) };
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    const base = out[k];
    out[k] = isPlainObject(v) && isPlainObject(base) && k === 'theme' ? { ...base, ...v } : v;
  }
  return out as C;
}

/** Which fields a platform override changes (for UI badges). */
export function overriddenKeys<C extends object>(overrides: PlatformOverrides<C> | undefined | null, platform: EngagePlatform): string[] {
  const o = overrides?.[platform];
  return o ? Object.entries(o).filter(([, v]) => v !== undefined).map(([k]) => k) : [];
}

// ---------------------------------------------------------------------------
// Personalisation (§4)
// ---------------------------------------------------------------------------

export const PERSONALISATION_TOKENS: readonly { key: string; label: string; sample: string }[] = [
  { key: 'first_name', label: 'First name', sample: 'Alex' },
  { key: 'streak', label: 'Current streak', sample: '12' },
  { key: 'circle_name', label: 'Circle name', sample: 'Morning Crew' },
  { key: 'days_left', label: 'Days left (campaign)', sample: '9' },
];

export const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(PERSONALISATION_TOKENS.map((t) => [t.key, t.sample]));

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*(?:\|\s*default:\s*"([^"]*)"\s*)?\}\}/g;

/** Renders `{{key}}` / `{{key | default: "…"}}`. Missing values use the default, else empty. */
export function personalise(text: string, values: Record<string, string | number | null | undefined>): string {
  return (text ?? '').replace(TOKEN_RE, (_m, key: string, def?: string) => {
    const v = values[key];
    return v === undefined || v === null || v === '' ? def ?? '' : String(v);
  });
}

export function tokensIn(text: string): string[] {
  return Array.from((text ?? '').matchAll(TOKEN_RE), (m) => m[1]);
}

// ---------------------------------------------------------------------------
// Rendering for preview / web
// ---------------------------------------------------------------------------

export function assetToRef(a: Pick<EngageAsset, 'id' | 'url' | 'variants' | 'width' | 'height' | 'dominantColor' | 'alt'>): AssetRef {
  return { id: a.id, url: a.url, variants: a.variants ?? [], width: a.width, height: a.height, dominantColor: a.dominantColor, alt: a.alt ?? null };
}

/** Picks the smallest variant ≥ needed px (falls back to the original). */
export function pickVariantUrl(ref: Pick<AssetRef, 'url' | 'variants' | 'width'>, neededPx: number): string {
  const vs = [...(ref.variants ?? [])].filter((v) => v.width > 0).sort((a, b) => a.width - b.width);
  const hit = vs.find((v) => v.width >= neededPx);
  if (hit) return hit.url;
  return ref.url;
}

export const DEFAULT_THEME: Required<EngageTheme> = {
  background: '#151a33',
  text: '#ffffff',
  accent: '#a78bfa',
  buttonBackground: '#8b5cf6',
  buttonText: '#ffffff',
};

export function resolveTheme(t: EngageTheme | undefined | null): Required<EngageTheme> {
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  return {
    background: hex(t?.background, DEFAULT_THEME.background),
    text: hex(t?.text, DEFAULT_THEME.text),
    accent: hex(t?.accent, DEFAULT_THEME.accent),
    buttonBackground: hex(t?.buttonBackground, DEFAULT_THEME.buttonBackground),
    buttonText: hex(t?.buttonText, DEFAULT_THEME.buttonText),
  };
}

/**
 * Authoring content → RenderedContent for a platform: override merged,
 * personalisation applied with `values`, image expanded from `assets`.
 */
export function renderContent(
  variant: Pick<MessageVariant<MessageContent>, 'content' | 'platformOverrides'>,
  platform: EngagePlatform,
  assets: Record<string, AssetRef | undefined>,
  values: Record<string, string | number | null | undefined> = SAMPLE_VALUES
): RenderedContent {
  const c = applyPlatformOverride(variant.content, variant.platformOverrides, platform);
  const p = (s: string | null | undefined) => (s == null ? s ?? null : personalise(s, values));
  return {
    ...c,
    title: personalise(c.title ?? '', values),
    body: personalise(c.body ?? '', values),
    badge: p(c.badge),
    imageAlt: c.imageAlt ?? null,
    buttons: (c.buttons ?? []).map((b) => ({ ...b, label: personalise(b.label, values) })),
    theme: resolveTheme(c.theme),
    image: c.image?.assetId ? assets[c.image.assetId] ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// Variants (§5)
// ---------------------------------------------------------------------------

export interface WeightCheck {
  ok: boolean;
  total: number;
  errors: string[];
}

export function validateWeights(variants: readonly Pick<MessageVariant, 'id' | 'weight'>[], controlWeight: number): WeightCheck {
  const errors: string[] = [];
  if (variants.length === 0) errors.push('Add at least one variant');
  if (!Number.isInteger(controlWeight) || controlWeight < 0 || controlWeight > 50) errors.push('Control must be 0–50%');
  for (const v of variants) {
    if (!Number.isInteger(v.weight) || v.weight < 0 || v.weight > 100) errors.push(`Variant ${v.id} weight must be 0–100`);
  }
  const ids = new Set(variants.map((v) => v.id));
  if (ids.size !== variants.length) errors.push('Variant ids must be unique');
  const total = variants.reduce((s, v) => s + (Number.isFinite(v.weight) ? v.weight : 0), 0) + (Number.isFinite(controlWeight) ? controlWeight : 0);
  if (total !== 100) errors.push(`Weights + control must total 100% (now ${total}%)`);
  if (variants.length > 0 && variants.every((v) => v.weight === 0)) errors.push('At least one variant needs weight');
  return { ok: errors.length === 0, total, errors };
}

/** Distributes 100 − control evenly across variants (remainder to the first ones). */
export function evenWeights(count: number, controlWeight: number): number[] {
  const pool = Math.max(0, 100 - controlWeight);
  if (count <= 0) return [];
  const base = Math.floor(pool / count);
  const rest = pool - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Sets one variant's weight and rebalances the others proportionally so the
 * total stays 100 − control.
 */
export function rebalance(weights: readonly number[], index: number, value: number, controlWeight: number): number[] {
  const pool = Math.max(0, 100 - controlWeight);
  const v = Math.max(0, Math.min(pool, Math.round(value)));
  if (weights.length <= 1) return [pool];
  const others = weights.map((w, i) => (i === index ? 0 : Math.max(0, w)));
  const othersSum = others.reduce((a, b) => a + b, 0);
  const remaining = pool - v;
  const out = others.map((w, i) => (i === index ? v : othersSum > 0 ? Math.floor((w / othersSum) * remaining) : Math.floor(remaining / (weights.length - 1))));
  let diff = pool - out.reduce((a, b) => a + b, 0);
  for (let i = 0; diff > 0 && i < out.length * 2; i++) {
    const j = i % out.length;
    if (j === index) continue;
    out[j]++;
    diff--;
  }
  return out;
}

export function nextVariantId(existing: readonly { id: string }[]): string {
  const used = new Set(existing.map((v) => v.id));
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  return `V${existing.length + 1}`;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultCardContent(): MessageContent {
  return {
    image: null,
    imageAlt: null,
    title: '',
    body: '',
    badge: null,
    buttons: [{ label: 'Take a look', action: { type: 'deeplink', value: 'circles' }, style: 'primary' }],
    theme: {},
    imageFit: 'cover',
    dismissible: true,
    pinned: false,
  };
}

export function defaultPushContent(): PushContent {
  return { title: '', body: '', image: null, action: { type: 'deeplink', value: 'home' } };
}

export function defaultEmailContent(): EmailContent {
  return { subject: '', preheader: '', heading: '', body: '', image: null, ctaLabel: 'Open FitCircle', action: { type: 'deeplink', value: 'home' } };
}

export function defaultContentFor(channel: EngageChannel): MessageContent | PushContent | EmailContent {
  if (channel === 'push') return defaultPushContent();
  if (channel === 'email') return defaultEmailContent();
  return defaultCardContent();
}

export function newMessageInput(channel: EngageChannel, now: Date = new Date()): MessageInput {
  const isCard = channel === 'content_card';
  const isIam = channel === 'in_app';
  return {
    name: '',
    campaignId: null,
    channel,
    placement: isCard ? 'home_feed' : null,
    layout: isCard ? 'card' : isIam ? 'modal' : null,
    variants: [{ id: 'A', name: 'Variant A', weight: 100, content: defaultContentFor(channel) }],
    controlWeight: 0,
    segmentId: null,
    audienceFilters: [],
    platforms: channel === 'push' ? ['ios', 'android'] : [],
    startsAt: now.toISOString(),
    endsAt: null,
    sendMode: channel === 'push' || channel === 'email' ? 'immediate' : null,
    sendAt: null,
    localHour: channel === 'push' || channel === 'email' ? 9 : null,
    trigger: isIam ? { event: 'app_open', filters: [], delaySeconds: 2 } : null,
    maxImpressionsPerUser: isIam ? 1 : null,
    minHoursBetween: isIam ? 24 : null,
    priority: 0,
    respectGlobalCap: true,
    conversion: null,
  };
}

/** Platforms a message actually reaches, after capability rules (§15). */
export function effectivePlatforms(channel: EngageChannel, platforms: readonly EngagePlatform[]): { reach: EngagePlatform[]; warnings: string[] } {
  const chosen = platforms.length ? [...platforms] : [...PLATFORMS];
  const warnings: string[] = [];
  let reach = chosen;
  if (channel === 'push' && chosen.includes('web')) {
    reach = chosen.filter((p) => p !== 'web');
    warnings.push('Web push isn’t supported: web users are excluded from this push.');
  }
  if (channel === 'push' && reach.length === 0) warnings.push('Push needs iOS or Android.');
  return { reach, warnings };
}

export function isCardContent(c: unknown): c is MessageContent {
  return isPlainObject(c) && 'buttons' in c && 'theme' in c;
}
export function isPushContent(c: unknown): c is PushContent {
  return isPlainObject(c) && 'action' in c && !('subject' in c) && !('buttons' in c);
}
export function isEmailContent(c: unknown): c is EmailContent {
  return isPlainObject(c) && 'subject' in c;
}
