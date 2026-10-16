/**
 * Server-only helpers for campaign pages: the admin gate (profiles.is_admin)
 * and a minimal public read of a published campaign for the signed-out
 * /c/{slug} landing + OG tags (the viewer API needs auth).
 */

import { createAdminSupabase } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';

import type { CampaignGlyph, CampaignTemplate } from './types';

export interface SessionUser {
  id: string;
  email: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

/** The signed-in admin, or null (non-admins and signed-out visitors). */
export async function getAdminUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  try {
    const { data } = await createAdminSupabase().from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    return (data as { is_admin?: boolean } | null)?.is_admin === true ? user : null;
  } catch {
    return null;
  }
}

/** Public (marketing) fields of a published campaign. */
export interface PublicCampaign {
  slug: string;
  template: CampaignTemplate;
  title: string;
  emoji: string;
  tagline: string;
  description: string;
  accent: string;
  palette: string[];
  glyph: CampaignGlyph;
  featuredFrom: string;
  startsAt: string;
  endsAt: string;
  art: { appStoreCard: string | null; inAppHero: string | null; appStoreDetails: string | null };
}

type ArtJson = Partial<Record<'appStoreCard' | 'appStoreDetails' | 'inAppHero' | 'emailHeader', { url?: string } | null>>;

export async function loadPublicCampaign(slug: string): Promise<PublicCampaign | null> {
  if (!/^[a-z0-9_]{3,40}$/.test(slug)) return null;
  try {
    const { data, error } = await createAdminSupabase()
      .from('campaigns')
      .select('slug, template, title, emoji, tagline, description, accent, palette, glyph, featured_from, starts_at, ends_at, art, published, archived_at')
      .eq('slug', slug)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    if (row.published !== true || row.archived_at) return null;
    const art = (row.art ?? {}) as ArtJson;
    return {
      slug: String(row.slug),
      template: row.template as CampaignTemplate,
      title: String(row.title ?? ''),
      emoji: String(row.emoji ?? ''),
      tagline: String(row.tagline ?? ''),
      description: String(row.description ?? ''),
      accent: String(row.accent ?? '#8b5cf6'),
      palette: Array.isArray(row.palette) ? (row.palette as string[]) : ['#8b5cf6', '#22d3ee', '#ec4899'],
      glyph: (row.glyph as CampaignGlyph) ?? 'star',
      featuredFrom: String(row.featured_from ?? row.starts_at ?? ''),
      startsAt: String(row.starts_at ?? ''),
      endsAt: String(row.ends_at ?? ''),
      art: {
        appStoreCard: art.appStoreCard?.url ?? null,
        inAppHero: art.inAppHero?.url ?? null,
        appStoreDetails: art.appStoreDetails?.url ?? null,
      },
    };
  } catch {
    return null;
  }
}
