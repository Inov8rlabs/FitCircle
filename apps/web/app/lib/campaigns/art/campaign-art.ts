/**
 * Maps campaign fields onto ring-art options for each art slot, and renders
 * every slot in the browser (Generate artwork, CAMPAIGNS_SPEC §9.4).
 */

import { artDateLine, diffDays, particlesFor, spanDays } from '../campaign-utils';
import { ART_SLOT_SIZES, type ArtSlot, type CampaignInput } from '../types';

import { buildRingArt, rasterize, type RingArtOptions } from './ring-art';

export type ArtSource = Pick<CampaignInput, 'template' | 'palette' | 'glyph' | 'startsAt' | 'endsAt' | 'marks' | 'slug'>;

export const ART_SLOTS: readonly ArtSlot[] = ['appStoreCard', 'appStoreDetails', 'inAppHero', 'emailHeader'];

function hashSeed(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647;
  return h || 7;
}

export function artOptionsFor(c: ArtSource, slot: ArtSlot, overrides: Partial<RingArtOptions> = {}): RingArtOptions {
  const size = ART_SLOT_SIZES[slot];
  const days = Math.max(1, Math.min(62, spanDays(c.startsAt, c.endsAt) || 30));
  const door = c.template === 'daily_calendar';
  const marks = (c.marks ?? [])
    .map((m) => ({ index: diffDays(c.startsAt, m.date), emoji: m.emoji }))
    .filter((m) => Number.isFinite(m.index) && m.index >= 0 && m.index < days && m.emoji);
  return {
    width: size.width,
    height: size.height,
    palette: c.palette,
    glyph: c.glyph,
    days,
    tick: door ? 'door' : 'line',
    lit: door ? Math.min(7, days) : days,
    marks,
    dateLine: artDateLine(c.startsAt, c.endsAt),
    year: (c.startsAt || '').slice(0, 4) || undefined,
    particles: particlesFor(c.glyph, c.palette),
    seed: hashSeed(c.slug || 'campaign'),
    ...overrides,
  };
}

export function svgFor(c: ArtSource, slot: ArtSlot, overrides?: Partial<RingArtOptions>): string {
  return buildRingArt(artOptionsFor(c, slot, overrides));
}

/** Renders one slot to a PNG Blob at its exact App Store / in-app size. */
export async function renderSlotPng(c: ArtSource, slot: ArtSlot, overrides?: Partial<RingArtOptions>): Promise<Blob> {
  const { width, height } = ART_SLOT_SIZES[slot];
  return rasterize(svgFor(c, slot, overrides), width, height);
}

/** `data:` URL of the SVG, for instant <img> previews without rasterising. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
