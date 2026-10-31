/**
 * Content rendering for delivery (docs/ENGAGE_SPEC.md §4, §15):
 *  - per-platform override merge (partial content over the variant content),
 *  - personalisation: {{first_name}}, {{streak}}, {{circle_name}}, {{days_left}}
 *    with `| default: "…"` (also single quotes),
 *  - `{ assetId }` → AssetRef.
 */
import type {
  AssetRef,
  EngagePlatform,
  EngageAsset,
  MessageContent,
  MessageVariant,
  RenderedContent,
} from './types';

export type PersonalVars = Partial<Record<'first_name' | 'streak' | 'circle_name' | 'days_left', string | number | null>>;

export const PERSONALISATION_KEYS = ['first_name', 'streak', 'circle_name', 'days_left'] as const;

const TOKEN = /\{\{\s*([a-z_]+)\s*(?:\|\s*default\s*:\s*(?:"([^"]*)"|'([^']*)'))?\s*\}\}/g;

export function personalise(text: string, vars: PersonalVars): string {
  if (!text) return text;
  return text
    .replace(TOKEN, (_m, key: string, d1?: string, d2?: string) => {
      const v = (vars as Record<string, unknown>)[key];
      const fallback = d1 ?? d2 ?? '';
      if (v === null || v === undefined || v === '') return fallback;
      return String(v);
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?;:])/g, '$1')
    .trim();
}

/** Keys referenced by any `{{…}}` in the strings (to skip unneeded lookups). */
export function referencedKeys(texts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(TOKEN)) out.add(m[1]);
  }
  return out;
}

/** Variant content with the caller platform's override merged on top (theme merges shallowly). */
export function mergeOverride<C extends Record<string, any>>(variant: Pick<MessageVariant<C>, 'content' | 'platformOverrides'>, platform: EngagePlatform | null): C {
  const base = variant.content;
  const o = platform ? variant.platformOverrides?.[platform] : undefined;
  if (!o) return base;
  const merged: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (k === 'theme' && v && typeof v === 'object') merged.theme = { ...(base.theme ?? {}), ...v };
    else merged[k] = v;
  }
  return merged as C;
}

export function toAssetRef(a: Pick<EngageAsset, 'id' | 'url' | 'variants' | 'width' | 'height' | 'dominantColor' | 'alt'>, altOverride?: string | null): AssetRef {
  return {
    id: a.id,
    url: a.url,
    variants: a.variants ?? [],
    width: a.width,
    height: a.height,
    dominantColor: a.dominantColor,
    alt: altOverride ?? a.alt ?? null,
  };
}

/** Every asset id referenced by a variant list (content + overrides). */
export function assetIdsOf(variants: Array<MessageVariant<any>>): string[] {
  const ids = new Set<string>();
  for (const v of variants ?? []) {
    const id = v?.content?.image?.assetId;
    if (id) ids.add(id);
    for (const o of Object.values(v?.platformOverrides ?? {})) {
      const oid = (o as any)?.image?.assetId;
      if (oid) ids.add(oid);
    }
  }
  return [...ids];
}

/** Card / in-app content ready for the wire. */
export function renderContent(content: MessageContent, vars: PersonalVars, assets: Map<string, AssetRef>): RenderedContent {
  const p = (s: string | null | undefined) => (s == null ? s ?? null : personalise(s, vars));
  const asset = content.image?.assetId ? assets.get(content.image.assetId) ?? null : null;
  return {
    imageAlt: content.imageAlt ?? null,
    title: p(content.title) ?? '',
    body: p(content.body) ?? '',
    badge: content.badge ? p(content.badge) : null,
    buttons: (content.buttons ?? []).map((b) => ({ ...b, label: p(b.label) ?? '', action: { type: b.action.type, value: b.action.value ?? null } })),
    theme: content.theme ?? {},
    imageFit: content.imageFit ?? 'cover',
    dismissible: content.dismissible !== false,
    pinned: !!content.pinned,
    image: asset ? { ...asset, alt: content.imageAlt ?? asset.alt ?? null } : null,
  };
}
