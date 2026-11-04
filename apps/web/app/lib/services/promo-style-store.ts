/**
 * Published system promo looks (feature_flags 'promo_styles', docs/PROMO_BUTTON_STYLE_SPEC.md): the read
 * + per-instance SWR cache the feed uses. Kept apart from PromoStyleService (admin) so the feed's
 * promo loaders don't import the admin services.
 */
import { swrCache } from '@/lib/home-feed/cache';
import { DEFAULT_PROMO_STYLES, PROMO_STYLES_FLAG, parsePromoStyles, promoStylesVersion, type PromoStylesConfig } from '@/lib/promos';
import { createAdminSupabase } from '@/lib/supabase-admin';

export interface PublishedStyles {
  config: PromoStylesConfig;
  source: 'database' | 'defaults';
  updatedAt: string | null;
  invalidStored: boolean;
  version: string;
}

/** Read the flag row. Never throws: errors → defaults (no styles). */
export async function readPublishedStyles(): Promise<PublishedStyles> {
  const fallback = (invalidStored = false, updatedAt: string | null = null): PublishedStyles => ({ config: DEFAULT_PROMO_STYLES, source: 'defaults', updatedAt, invalidStored, version: promoStylesVersion(DEFAULT_PROMO_STYLES) });
  try {
    const { data, error } = await createAdminSupabase().from('feature_flags').select('name, metadata, updated_at').eq('name', PROMO_STYLES_FLAG).maybeSingle();
    if (error) throw error;
    if (!data) return fallback();
    const row = data as { metadata: unknown; updated_at: string | null };
    const parsed = parsePromoStyles(row.metadata);
    if (!parsed) {
      console.warn('[promo-styles] stored config is invalid; serving no styles');
      return fallback(true, row.updated_at ?? null);
    }
    return { config: parsed, source: 'database', updatedAt: row.updated_at ?? null, invalidStored: false, version: promoStylesVersion(parsed) };
  } catch (err: any) {
    console.warn('[promo-styles] config read failed; serving no styles:', err?.message ?? err);
    return fallback();
  }
}

/** Per-instance cache (fresh 30 s, stale ≤ 10 min). */
export const promoStylesCache = swrCache<PublishedStyles>(readPublishedStyles, { ttlMs: 30_000, maxStaleMs: 600_000, label: 'promo styles' });

