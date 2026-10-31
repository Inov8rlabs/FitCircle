/**
 * Campaign row ⇄ wire mapping and the pure date rules (phase, status, day
 * numbers). docs/CAMPAIGNS_SPEC.md §1–§3.
 */
import { addDays, daysBetween } from '@/lib/streaks/streak-calculator';

import type {
  AdminCampaign,
  ArtAsset,
  ArtSlot,
  CalendarDoorContent,
  CampaignAppStore,
  CampaignEmail,
  CampaignGlyph,
  CampaignInput,
  CampaignMark,
  CampaignNotification,
  CampaignPhase,
  CampaignStatus,
  CampaignTemplate,
  CampaignCtaAction,
  CircleTemplate,
} from './types';

/** `campaigns` table row (snake_case, as Supabase returns it). */
export interface CampaignRow {
  id: string;
  slug: string;
  template: CampaignTemplate;
  published: boolean;
  published_at: string | null;
  archived_at: string | null;
  title: string;
  emoji: string;
  tagline: string;
  description: string;
  cta_label: string | null;
  accent: string;
  palette: string[];
  glyph: CampaignGlyph;
  featured_from: string;
  starts_at: string;
  ends_at: string;
  priority: number;
  cta: { action: CampaignCtaAction; url?: string | null } | null;
  circle_template: CircleTemplate | null;
  calendar: { doors: CalendarDoorContent[] } | null;
  marks: CampaignMark[] | null;
  art: Partial<Record<ArtSlot, ArtAsset>> | null;
  notifications: CampaignNotification[] | null;
  emails: CampaignEmail[] | null;
  app_store: (CampaignAppStore & Record<string, unknown>) | null;
  play: { title?: string; description?: string; exportedAt?: string | null } | null;
  legacy_season_key: string | null;
  preview_user_ids: string[] | null;
  /** ios | android | web; empty = all (migration 104). */
  platforms?: string[] | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Days after ends_at the `ended` wrap-up stays visible. */
export const ENDED_GRACE_DAYS = 2;

export const PHASE_RANK: Record<CampaignPhase, number> = { live: 0, teaser: 1, ended: 2 };

type Dated = { featured_from: string; starts_at: string; ends_at: string };

/** Viewer phase for local day `today`, or null when the campaign isn't shown. */
export function computePhase(c: Dated, today: string): CampaignPhase | null {
  if (c.starts_at <= today && today <= c.ends_at) return 'live';
  if (c.featured_from <= today && today < c.starts_at) return 'teaser';
  if (c.ends_at < today && today <= addDays(c.ends_at, ENDED_GRACE_DAYS)) return 'ended';
  return null;
}

/** Admin status (§1). */
export function computeStatus(
  c: Dated & { published: boolean; archived_at: string | null },
  today: string
): CampaignStatus {
  if (c.archived_at) return 'archived';
  if (!c.published) return 'draft';
  if (today < c.featured_from) return 'scheduled';
  if (today > c.ends_at) return 'ended';
  return 'live';
}

/** Inclusive number of days in the live window. */
export function totalDaysOf(c: { starts_at: string; ends_at: string }): number {
  return daysBetween(c.starts_at, c.ends_at) + 1;
}

/** Local date of 1-based day `n` of the window. */
export function dateOfDay(c: { starts_at: string }, n: number): string {
  return addDays(c.starts_at, n - 1);
}

export function rowToAdmin(row: CampaignRow, today: string): AdminCampaign {
  const appStore = { ...(row.app_store ?? {}) } as CampaignAppStore;
  return {
    id: row.id,
    slug: row.slug,
    template: row.template,
    title: row.title,
    emoji: row.emoji,
    tagline: row.tagline,
    description: row.description,
    ctaLabel: row.cta_label,
    accent: row.accent,
    palette: (row.palette ?? []) as [string, string, string],
    glyph: row.glyph,
    featuredFrom: row.featured_from,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    priority: row.priority ?? 0,
    cta: { action: row.cta?.action ?? 'start_circle', url: row.cta?.url ?? null },
    circle: row.circle_template ?? null,
    calendar: row.calendar ?? null,
    marks: row.marks ?? [],
    notifications: row.notifications ?? [],
    emails: row.emails ?? [],
    appStore,
    play: row.play ?? {},
    platforms: (row.platforms ?? []) as AdminCampaign['platforms'],
    status: computeStatus(row, today),
    published: !!row.published,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    art: row.art ?? {},
    legacySeasonKey: row.legacy_season_key,
    previewUserIds: row.preview_user_ids ?? [],
    version: row.version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Server-managed App Store fields a PATCH must never overwrite. */
const APP_STORE_SERVER_KEYS = ['eventId', 'state', 'lastSyncedAt', 'lastError', 'localizationId', 'screenshots', 'submissionId'] as const;

/** CampaignInput → column patch. `existingAppStore` keeps the server-managed keys. */
export function inputToColumns(input: CampaignInput, existingAppStore: Record<string, unknown> = {}): Partial<CampaignRow> {
  const appStore: Record<string, unknown> = { ...input.appStore };
  for (const k of APP_STORE_SERVER_KEYS) {
    if (existingAppStore[k] !== undefined) appStore[k] = existingAppStore[k];
    else delete appStore[k];
  }
  return {
    slug: input.slug,
    template: input.template,
    title: input.title,
    emoji: input.emoji,
    tagline: input.tagline,
    description: input.description,
    cta_label: input.ctaLabel ? input.ctaLabel : null,
    accent: input.accent,
    palette: [...input.palette],
    glyph: input.glyph,
    featured_from: input.featuredFrom,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    priority: input.priority,
    cta: { action: input.cta.action, url: input.cta.url ?? null },
    circle_template: input.circle,
    calendar: input.calendar,
    marks: input.marks,
    notifications: input.notifications,
    emails: input.emails,
    app_store: appStore as CampaignRow['app_store'],
    play: input.play,
    ...(input.platforms ? { platforms: [...new Set(input.platforms)] } : {}),
  };
}

/** AdminCampaign → the editable CampaignInput subset (for PATCH merging). */
export function adminToInput(a: AdminCampaign): CampaignInput {
  return {
    slug: a.slug,
    template: a.template,
    title: a.title,
    emoji: a.emoji,
    tagline: a.tagline,
    description: a.description,
    ctaLabel: a.ctaLabel ?? null,
    accent: a.accent,
    palette: a.palette,
    glyph: a.glyph,
    featuredFrom: a.featuredFrom,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    priority: a.priority,
    cta: a.cta,
    circle: a.circle,
    calendar: a.calendar,
    marks: a.marks,
    notifications: a.notifications,
    emails: a.emails,
    appStore: a.appStore,
    play: a.play,
    platforms: a.platforms ?? [],
  };
}
