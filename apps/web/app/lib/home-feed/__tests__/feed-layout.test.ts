import { describe, expect, it, vi } from 'vitest';

import { cardsParam, defaultLayout, fetchHomeFeed, parseHomeFeed } from '../feed-layout';

describe('defaultLayout', () => {
  it('matches the spec default without a campaign (hydration right under the header, referral after it)', () => {
    expect(defaultLayout(false).cards.map((c) => c.type).slice(0, 4)).toEqual(['header', 'hydration', 'referral', 'streak_warning']);
  });

  it('moves hydration + referral below progress when a campaign is present', () => {
    const order = defaultLayout(true).cards.map((c) => c.type);
    expect(order.slice(0, 2)).toEqual(['header', 'campaign']);
    expect(order.indexOf('hydration')).toBe(order.indexOf('progress') + 1);
    expect(order.indexOf('referral')).toBe(order.indexOf('hydration') + 1);
  });
});

describe('parseHomeFeed', () => {
  const body = {
    schema: 1,
    decision_id: 'd1',
    layout_key: 'default-v1',
    cards: [
      { id: 'hydration', type: 'hydration', version: 1 },
      { id: 'header', type: 'header', version: 1 },
      { id: 'campaign:htl', type: 'campaign', version: 1, props: { slug: 'htl' } },
      { id: 'native_ad', type: 'native_ad', version: 1 },
      { id: 'hydration', type: 'hydration', version: 1 },
      { id: 'future', type: 'progress', version: 2 },
    ],
  };

  it('keeps known cards in server order, forces header first, drops unknown/duplicate/newer', () => {
    const layout = parseHomeFeed(body)!;
    expect(layout.source).toBe('server');
    expect(layout.decisionId).toBe('d1');
    expect(layout.cards.map((c) => c.id)).toEqual(['header', 'hydration', 'campaign:htl']);
    expect(layout.cards[2].props).toEqual({ slug: 'htl' });
  });

  it('accepts the success envelope too', () => {
    expect(parseHomeFeed({ success: true, data: body })?.cards).toHaveLength(3);
  });

  it('rejects other schemas and junk', () => {
    expect(parseHomeFeed({ ...body, schema: 2 })).toBeNull();
    expect(parseHomeFeed({ schema: 1, cards: [{ type: 'native_ad' }] })).toBeNull();
    expect(parseHomeFeed(null)).toBeNull();
    expect(parseHomeFeed('x')).toBeNull();
  });
});

describe('fetchHomeFeed', () => {
  it('sends the schema header and cards list, and parses a 200', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ schema: 1, cards: [{ id: 'header', type: 'header', version: 1 }] })));
    const layout = await fetchHomeFeed({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(layout?.cards.map((c) => c.type)).toEqual(['header']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`cards=${encodeURIComponent(cardsParam())}`);
    expect((init.headers as Record<string, string>)['X-Feed-Schema']).toBe('1');
    expect(init.credentials).toBe('include');
  });

  it('returns null on 404 (endpoint not deployed) and on network errors', async () => {
    expect(await fetchHomeFeed({ fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch })).toBeNull();
    expect(await fetchHomeFeed({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch })).toBeNull();
  });
});
