import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const sentry = vi.hoisted(() => ({ addBreadcrumb: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentry);

import {
  __resetDroppedKeyReportsForTests,
  findDroppedKeys,
  reportDroppedKeys,
  routeFromStack,
} from '../dropped-keys';
import { parseLenient, safeParseLenient } from '../lenient-parse';

describe('findDroppedKeys', () => {
  const schema = z.object({
    trackingDate: z.string().optional(),
    weightKg: z.number().optional(),
    items: z.array(z.object({ name: z.string(), grams: z.number().optional() })).optional(),
    meta: z.object({ source: z.string() }).optional(),
  });

  it('lists top-level keys the schema strips (the iOS "date" bug)', () => {
    expect(findDroppedKeys(schema, { date: '2026-11-01', weightKg: 80 })).toEqual(['date']);
  });

  it('reports nested and array-element keys as dotted paths, deduplicated', () => {
    expect(
      findDroppedKeys(schema, {
        items: [{ name: 'a', servingUnit: 'g' }, { name: 'b', servingUnit: 'oz' }],
        meta: { source: 'x', deviceId: 'd' },
      })
    ).toEqual(['items[].servingUnit', 'meta.deviceId']);
  });

  it('reports nothing for correctly keyed bodies, passthrough objects or catchalls', () => {
    expect(findDroppedKeys(schema, { trackingDate: '2026-11-01', weightKg: 80 })).toEqual([]);
    expect(findDroppedKeys(z.object({ a: z.string() }).passthrough(), { a: 'x', b: 1 })).toEqual([]);
    expect(findDroppedKeys(z.object({ a: z.string() }).catchall(z.number()), { a: 'x', b: 1 })).toEqual([]);
  });

  it('sees through optional/default/refine wrappers and applies preprocess renames first', () => {
    const refined = schema.refine(() => true).optional();
    expect(findDroppedKeys(refined, { date: 'x' })).toEqual(['date']);

    const renamed = z.preprocess(
      (v) => {
        const o = { ...(v as Record<string, unknown>) };
        if ('date' in o) {
          o.trackingDate = o.date;
          delete o.date;
        }
        return o;
      },
      z.object({ trackingDate: z.string() })
    );
    expect(findDroppedKeys(renamed, { date: '2026-11-01' })).toEqual([]);
  });

  it('handles unions (only keys no branch knows), discriminated unions and intersections', () => {
    const union = z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]);
    expect(findDroppedKeys(union, { a: 'x', b: 'y', c: 'z' })).toEqual(['c']);

    const du = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.number() }),
      z.object({ kind: z.literal('b'), y: z.number() }),
    ]);
    expect(findDroppedKeys(du, { kind: 'a', x: 1, y: 2 })).toEqual(['y']);

    const both = z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));
    expect(findDroppedKeys(both, { a: 'x', b: 'y', c: 'z' })).toEqual(['c']);
  });

  it('never throws on odd input', () => {
    expect(findDroppedKeys(schema, null)).toEqual([]);
    expect(findDroppedKeys(schema, 'string')).toEqual([]);
    expect(findDroppedKeys(schema, [1, 2])).toEqual([]);
  });
});

describe('reportDroppedKeys', () => {
  const schema = z.object({ trackingDate: z.string().optional() });

  beforeEach(() => {
    __resetDroppedKeyReportsForTests();
    sentry.addBreadcrumb.mockClear();
    sentry.captureMessage.mockClear();
  });

  it('logs key names only (never values), once per route+keyset, and signals Sentry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = { date: '2026-11-01-SECRET-VALUE' };
    reportDroppedKeys(schema, body, { route: '/api/mobile/tracking/daily' });
    reportDroppedKeys(schema, body, { route: '/api/mobile/tracking/daily' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[api-dropped-keys]');
    expect(JSON.parse(warn.mock.calls[0][1] as string)).toEqual({
      route: '/api/mobile/tracking/daily',
      keys: ['date'],
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sentry.captureMessage.mock.calls)).not.toContain('SECRET');
    expect(sentry.addBreadcrumb).toHaveBeenCalledTimes(2);

    // A different keyset on the same route is a new report.
    reportDroppedKeys(schema, { other: 1 }, { route: '/api/mobile/tracking/daily' });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('is silent when nothing is dropped or every dropped key is ignored', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(reportDroppedKeys(schema, { trackingDate: '2026-11-01' }, { route: 'r' })).toEqual([]);
    expect(reportDroppedKeys(schema, { id: 'x' }, { route: 'r', ignore: ['id'] })).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('derives the route from the calling route file', () => {
    expect(routeFromStack('Error\n    at POST (/repo/apps/web/app/api/mobile/tracking/daily/route.ts:10:5)')).toBe(
      '/api/mobile/tracking/daily'
    );
    expect(
      routeFromStack('Error\n    at POST (/var/task/apps/web/.next/server/app/api/mobile/food-log/[id]/route.js:1:2)')
    ).toBe('/api/mobile/food-log/[id]');
    expect(routeFromStack('Error\n    at x (/somewhere/else.js:1:1)')).toBe('unknown');
  });
});

describe('parseLenient / safeParseLenient report but do not change results', () => {
  const schema = z.object({ trackingDate: z.string().optional(), weightKg: z.number().optional() });

  beforeEach(() => {
    __resetDroppedKeyReportsForTests();
    sentry.captureMessage.mockClear();
  });

  it('parses exactly as before and reports the dropped key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseLenient(schema, { date: '2026-11-01', weightKg: 80, trackingDate: null })).toEqual({ weightKg: 80 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);

    const bad = safeParseLenient(schema, { weightKg: 'heavy', extra: true }, { route: 'x' });
    expect(bad.success).toBe(false);
    warn.mockRestore();
  });
});
