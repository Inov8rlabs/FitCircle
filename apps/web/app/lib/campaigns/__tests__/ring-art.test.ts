import { describe, expect, it } from 'vitest';

import { artOptionsFor, svgFor } from '../art/campaign-art';
import { buildRingArt, escapeXml, ringLayout, type RingArtOptions } from '../art/ring-art';
import type { CampaignGlyph } from '../types';
import { ART_SLOT_SIZES } from '../types';

const GLYPHS: CampaignGlyph[] = ['snowflake', 'gift', 'year', 'sun', 'moon', 'flame', 'leaf', 'heart', 'star', 'bolt'];

const base: RingArtOptions = {
  width: 1920,
  height: 1080,
  palette: ['#8b5cf6', '#22d3ee', '#ec4899'],
  glyph: 'snowflake',
  days: 30,
  dateLine: 'NOV 15 – DEC 15',
};

function count(svg: string, re: RegExp): number {
  return (svg.match(re) ?? []).length;
}

describe('buildRingArt', () => {
  it.each(Object.entries(ART_SLOT_SIZES))('renders %s at its exact size', (_slot, { width, height }) => {
    const svg = buildRingArt({ ...base, width, height });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it.each(GLYPHS)('glyph %s produces finite geometry', (glyph) => {
    for (const { width, height } of Object.values(ART_SLOT_SIZES)) {
      const svg = buildRingArt({ ...base, glyph, width, height, year: 2027 });
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it('draws one numbered door per day for daily calendars', () => {
    const svg = buildRingArt({ ...base, glyph: 'gift', tick: 'door', days: 24, lit: 7 });
    // doors are the only rotated rects with an rx; lit ones filled, rest outlined
    expect(count(svg, /<rect [^>]*transform="rotate\(/g)).toBe(24 * 2 - (24 - 7)); // lit doors drawn twice (glow + crisp)
    for (let d = 1; d <= 24; d++) expect(svg).toContain(`>${d}</text>`);
    expect(count(svg, /fill="#fbbf24"/g)).toBe(2); // today's door (glow + crisp)
  });

  it('draws line ticks (no doors) by default', () => {
    const svg = buildRingArt({ ...base, days: 31 });
    expect(count(svg, /<line [^>]*stroke="rgb\(/g)).toBe(31 * 2);
    expect(svg).not.toContain('>1</text>');
  });

  it('places marks and escapes text', () => {
    const svg = buildRingArt({ ...base, marks: [{ index: 0, emoji: '🎉' }, { index: 99, emoji: '🚫' }], dateLine: 'A & B <C>' });
    expect(svg).toContain('🎉');
    expect(svg).not.toContain('🚫');
    expect(svg).toContain('A &amp; B &lt;C&gt;');
  });

  it('renders the year number for the year glyph', () => {
    const svg = buildRingArt({ ...base, glyph: 'year', year: '2027' });
    expect(count(svg, />2027<\/text>/g)).toBe(2);
  });

  it('shows the requested number of friends', () => {
    expect(count(buildRingArt({ ...base, friends: 3 }), /fill="#10b981"/g)).toBe(3);
    expect(count(buildRingArt({ ...base }), /fill="#10b981"/g)).toBe(6);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    expect(buildRingArt({ ...base, seed: 3 })).toBe(buildRingArt({ ...base, seed: 3 }));
    expect(buildRingArt({ ...base, seed: 3 })).not.toBe(buildRingArt({ ...base, seed: 4 }));
  });

  it('confetti vs snow particles', () => {
    const confetti = buildRingArt({ ...base, particles: 'confetti' });
    const none = buildRingArt({ ...base, particles: 'none' });
    expect(count(confetti, /rx="1" fill=/g)).toBeGreaterThan(20);
    expect(count(none, /rx="1" fill=/g)).toBe(0);
  });

  it('tolerates bad input', () => {
    const svg = buildRingArt({ ...base, days: Number.NaN, palette: ['nope', '', '#zzzzzz'], lit: -4, seed: 0 });
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(svg).toContain('#8b5cf6');
  });
});

describe('ringLayout', () => {
  it('portrait / landscape / wide', () => {
    expect(ringLayout(1080, 1920).kind).toBe('portrait');
    expect(ringLayout(1920, 1080).kind).toBe('landscape');
    expect(ringLayout(1200, 675).kind).toBe('landscape');
    const wide = ringLayout(1200, 480);
    expect(wide.kind).toBe('wide');
    expect(wide.cx).toBeGreaterThan(600);
    // ring + avatars fit vertically
    expect(wide.cy - wide.R - 60 * wide.k).toBeGreaterThan(0);
    expect(wide.cy + wide.R + 60 * wide.k).toBeLessThan(480);
  });
});

describe('artOptionsFor', () => {
  const advent = {
    slug: 'advent_2026',
    template: 'daily_calendar' as const,
    palette: ['#f43f5e', '#f59e0b', '#a855f7'] as [string, string, string],
    glyph: 'gift' as const,
    startsAt: '2026-12-01',
    endsAt: '2026-12-24',
    marks: [
      { date: '2026-12-06', emoji: '🎅', label: 'St Nicholas' },
      { date: '2026-12-24', emoji: '🎄', label: 'Eve' },
      { date: '2027-01-02', emoji: '❌', label: 'outside' },
    ],
  };

  it('derives days, doors, marks, date line and year', () => {
    const o = artOptionsFor(advent, 'appStoreCard');
    expect(o.days).toBe(24);
    expect(o.tick).toBe('door');
    expect(o.marks).toEqual([{ index: 5, emoji: '🎅' }, { index: 23, emoji: '🎄' }]);
    expect(o.dateLine).toBe('DEC 1 – 24');
    expect(o.year).toBe('2026');
    expect(o.particles).toBe('snow');
    expect([o.width, o.height]).toEqual([1920, 1080]);
  });

  it('renders every slot without NaN', () => {
    for (const slot of ['appStoreCard', 'appStoreDetails', 'inAppHero', 'emailHeader'] as const) {
      expect(svgFor(advent, slot)).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe('escapeXml', () => {
  it('escapes markup characters', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});
