/**
 * The icon-key contract (design/icons.json → icons.generated.ts): the generated
 * file is current, every platform name is real (lucide checked here; SF Symbols
 * and Material Symbols were checked against AppKit / the Material codepoints
 * when the registry was written), and EVERY icon key the API can emit, from
 * code, admin defaults or migration 114, is in the registry.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOOR_IDEAS, GLYPHS, howItWorksFor } from '@/lib/campaigns/campaign-utils';
import { CHALLENGE_TEMPLATES } from '@/lib/data/challenge-templates';
import { firstMeal, LOG_MEAL_COPY, meetFitzy, proValueCreatives } from '@/lib/promos/system-promos';
import { SEASONS } from '@/lib/seasonal/seasons';
import { MILESTONES } from '@/lib/streaks/streak-config';

import { ICON_FALLBACK, ICON_KEYS, ICONS, iconKeyForEmoji, isIconKey, resolveIconKey } from '../icons';
import { OG_ICON_KEYS, ogIconSvg } from '../og-icons';

const REPO = resolve(__dirname, '../../../../../..');
const LUCIDE = resolve(REPO, 'node_modules/lucide-react/dist/esm/icons');

describe('registry', () => {
  it('icons.generated.ts matches design/icons.json', () => {
    const out = execFileSync('node', [resolve(REPO, 'design/codegen.mjs'), '--check', '--only', 'web'], { encoding: 'utf8' });
    expect(out).toContain('ok: web');
  });

  it('has the DESIGN_LANGUAGE §1 keys and a valid fallback', () => {
    for (const k of ['camera', 'strength', 'trophy', 'flame', 'target', 'chart_bar', 'trend', 'community', 'bolt', 'stopwatch', 'alarm', 'hourglass', 'run', 'walk', 'mindful', 'cycle', 'strength_training', 'water', 'beverage', 'meal', 'celebration', 'wave', 'crown']) {
      expect(isIconKey(k), k).toBe(true);
    }
    expect(isIconKey(ICON_FALLBACK)).toBe(true);
  });

  it.runIf(existsSync(LUCIDE))('every web name is a lucide icon', () => {
    for (const k of ICON_KEYS) expect(existsSync(resolve(LUCIDE, `${ICONS[k].web}.js`)), `${k} → ${ICONS[k].web}`).toBe(true);
  });

  it('maps legacy emoji (with or without U+FE0F, ZWJ variants) to keys', () => {
    expect(iconKeyForEmoji('🔥')).toBe('flame');
    expect(iconKeyForEmoji('❄️')).toBe('snowflake');
    expect(iconKeyForEmoji('❄')).toBe('snowflake');
    expect(iconKeyForEmoji('🧘‍♀️')).toBe('mindful');
    expect(iconKeyForEmoji('🏃🏽‍♂️')).toBe('run');
    expect(iconKeyForEmoji('🦄')).toBeNull();
    expect(resolveIconKey('nope', '🦄')).toBe(ICON_FALLBACK);
    expect(resolveIconKey('trophy', '🔥')).toBe('trophy');
  });
});

describe('every key the API emits is registered', () => {
  const expectKeys = (label: string, keys: unknown[]) => {
    expect(keys.length, label).toBeGreaterThan(0);
    for (const k of keys) expect(isIconKey(k), `${label}: ${String(k)}`).toBe(true);
  };

  it('streak milestones', () => expectKeys('streak', MILESTONES.map((m) => m.icon)));

  it('momentum milestones (service source)', () => {
    const src = readFileSync(resolve(REPO, 'apps/web/app/lib/services/momentum-service.ts'), 'utf8');
    expectKeys('momentum', [...src.matchAll(/badge: '[^']+', icon: '([a-z_]+)'/g)].map((m) => m[1]));
  });

  it('challenge templates (code)', () => {
    expectKeys('templates', CHALLENGE_TEMPLATES.map((t) => t.icon_key));
    for (const t of CHALLENGE_TEMPLATES) expect(iconKeyForEmoji(t.icon), t.id).toBe(t.icon_key);
  });

  it('campaign glyphs, door ideas, how-it-works steps', () => {
    expectKeys('glyphs', GLYPHS.map((g) => g.icon));
    expectKeys('doors', DOOR_IDEAS.map((d) => d.icon));
    for (const template of ['seasonal_circle', 'daily_calendar', 'spotlight'] as const) {
      expectKeys(template, howItWorksFor({ template, startsAt: '2026-12-01', endsAt: '2026-12-24' }).map((s) => s.icon));
    }
  });

  it('seasons', () => expectKeys('seasons', SEASONS.map((s) => s.icon)));

  it('system promos', () => {
    const creatives = [
      ...firstMeal.creatives({} as any),
      ...meetFitzy.creatives({ journey: { lastMeal: null } } as any),
      ...proValueCreatives(new Set(['food_ai_unlimited', 'history_extended', 'ads_removed'])),
    ];
    expectKeys('promos', [...creatives.map((c) => c.icon), ...Object.values(LOG_MEAL_COPY).map((c) => c.icon)]);
  });

  it('migration 114 writes only registered keys', () => {
    const sql = readFileSync(resolve(REPO, 'supabase/migrations/114_icon_keys_emoji_cleanup.sql'), 'utf8');
    const pairs = [...sql.matchAll(/^\s+\('([^']*)', '([a-z_]+)'\)[,;]?$/gm)].map((m) => m[2]);
    const literals = [...sql.matchAll(/'(sparkles|calendar|trophy|milestone)'/g)].map((m) => m[1]);
    expect(pairs.length).toBeGreaterThan(90);
    expectKeys('114', [...pairs, ...literals]);
  });

  it('every emoji in the 103 campaign seeds maps to a key', () => {
    const sql = readFileSync(resolve(REPO, 'supabase/migrations/103_campaigns.sql'), 'utf8');
    const emoji = [...sql.matchAll(/"emoji":"([^"]+)"/g)].map((m) => m[1]);
    expect(emoji.length).toBeGreaterThan(25);
    for (const e of emoji) expect(iconKeyForEmoji(e), e).not.toBeNull();
  });

  it('OG share-card icons are registered and render as SVG', () => {
    expectKeys('og', OG_ICON_KEYS);
    for (const k of OG_ICON_KEYS) expect(ogIconSvg(k)).toMatch(/^<svg [^>]+>.+<\/svg>$/);
  });
});
