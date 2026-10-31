import { describe, expect, it } from 'vitest';

import type { AssetRef, MessageContent } from '../../types';
import {
  applyPlatformOverride,
  defaultCardContent,
  effectivePlatforms,
  evenWeights,
  newMessageInput,
  overriddenKeys,
  personalise,
  pickVariantUrl,
  rebalance,
  renderContent,
  resolveTheme,
  validateWeights,
} from '../content';

const base: MessageContent = {
  ...defaultCardContent(),
  title: 'Hi {{first_name}}',
  body: 'Streak {{streak | default: "0"}}',
  theme: { background: '#000000', accent: '#ff0000' },
  image: { assetId: 'a1' },
};

describe('applyPlatformOverride', () => {
  it('returns the base content without an override', () => {
    expect(applyPlatformOverride(base, undefined, 'ios')).toBe(base);
    expect(applyPlatformOverride(base, { android: { title: 'x' } }, 'ios')).toBe(base);
  });
  it('replaces scalars and arrays, merges theme, keeps undefined, clears null', () => {
    const merged = applyPlatformOverride(
      base,
      {
        android: {
          title: 'Get it on Google Play',
          buttons: [{ label: 'Play', action: { type: 'url', value: 'https://play.google.com' }, style: 'primary' }],
          theme: { accent: '#00ff00' },
          body: undefined,
          image: null,
        },
      },
      'android'
    );
    expect(merged.title).toBe('Get it on Google Play');
    expect(merged.buttons).toHaveLength(1);
    expect(merged.buttons[0].label).toBe('Play');
    expect(merged.theme).toEqual({ background: '#000000', accent: '#00ff00' });
    expect(merged.body).toBe(base.body);
    expect(merged.image).toBeNull();
    expect(base.title).toBe('Hi {{first_name}}'); // not mutated
  });
  it('lists overridden keys', () => {
    expect(overriddenKeys({ web: { title: 'a', body: undefined } }, 'web')).toEqual(['title']);
  });
});

describe('personalise', () => {
  it('renders tokens and defaults', () => {
    expect(personalise('Hi {{ first_name }}!', { first_name: 'Ani' })).toBe('Hi Ani!');
    expect(personalise('Hi {{first_name | default: "friend"}}', {})).toBe('Hi friend');
    expect(personalise('{{unknown}}x', {})).toBe('x');
  });
});

describe('renderContent', () => {
  const asset: AssetRef = { id: 'a1', url: 'https://cdn/a.png', variants: [{ width: 480, url: 'https://cdn/a@480.webp', format: 'webp' }], width: 1200, height: 675, dominantColor: '#123456', alt: null };
  it('merges override, personalises and expands the image', () => {
    const r = renderContent({ content: base, platformOverrides: { web: { title: 'Web {{first_name}}' } } }, 'web', { a1: asset }, { first_name: 'Sam' });
    expect(r.title).toBe('Web Sam');
    expect(r.body).toBe('Streak 0');
    expect(r.image?.url).toBe('https://cdn/a.png');
    expect(r.theme.buttonBackground).toBe('#8b5cf6');
    expect(r.theme.background).toBe('#000000');
  });
  it('picks the smallest sufficient variant', () => {
    expect(pickVariantUrl(asset, 300)).toBe('https://cdn/a@480.webp');
    expect(pickVariantUrl(asset, 900)).toBe('https://cdn/a.png');
  });
  it('theme falls back on bad hex', () => {
    expect(resolveTheme({ text: 'red' }).text).toBe('#ffffff');
  });
});

describe('weights', () => {
  it('validates totals and bounds', () => {
    expect(validateWeights([{ id: 'A', weight: 50 }, { id: 'B', weight: 40 }], 10).ok).toBe(true);
    expect(validateWeights([{ id: 'A', weight: 50 }, { id: 'B', weight: 40 }], 0).errors[0]).toMatch(/total 100/);
    expect(validateWeights([{ id: 'A', weight: 100 }], 60).ok).toBe(false);
    expect(validateWeights([{ id: 'A', weight: 50 }, { id: 'A', weight: 50 }], 0).errors).toContain('Variant ids must be unique');
    expect(validateWeights([], 0).ok).toBe(false);
    expect(validateWeights([{ id: 'A', weight: 50.5 }, { id: 'B', weight: 49.5 }], 0).ok).toBe(false);
  });
  it('even split and rebalance keep the total', () => {
    expect(evenWeights(3, 10)).toEqual([30, 30, 30]);
    expect(evenWeights(3, 0)).toEqual([34, 33, 33]);
    const r = rebalance([50, 30, 20], 0, 70, 0);
    expect(r[0]).toBe(70);
    expect(r.reduce((a, b) => a + b, 0)).toBe(100);
    const r2 = rebalance([45, 45], 1, 80, 10);
    expect(r2).toEqual([10, 80]);
    expect(rebalance([100], 0, 30, 20)).toEqual([80]);
  });
});

describe('defaults and capabilities', () => {
  it('new messages are valid per channel', () => {
    for (const ch of ['content_card', 'in_app', 'push', 'email'] as const) {
      const m = newMessageInput(ch);
      expect(validateWeights(m.variants, m.controlWeight).ok).toBe(true);
    }
    expect(newMessageInput('in_app').trigger?.event).toBe('app_open');
  });
  it('push excludes web', () => {
    expect(effectivePlatforms('push', []).reach).toEqual(['ios', 'android']);
    expect(effectivePlatforms('push', ['web']).warnings.length).toBe(2);
    expect(effectivePlatforms('content_card', []).reach).toEqual(['ios', 'android', 'web']);
  });
});
