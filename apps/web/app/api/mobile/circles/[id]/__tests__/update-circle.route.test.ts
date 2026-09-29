import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

import { iosEnvelopeProblems, iosFitCircleProblems } from '../../__tests__/ios-models';

const requireMobileAuth = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_request: unknown, response: unknown) => response,
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

import { PUT } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const DAY = 86_400_000;
/** A whole-second instant `days` from now, as Supabase returns a timestamptz. */
const stored = (days: number) =>
  new Date(Math.floor((Date.now() + days * DAY) / 1000) * 1000).toISOString().replace('.000Z', '+00:00');
/** The same instant as Swift's JSONEncoder `.iso8601` writes it. */
const asIos = (supabaseValue: string) => new Date(supabaseValue).toISOString().replace('.000Z', 'Z');

const put = (body: unknown, circleId = CIRCLE) =>
  PUT(
    new Request(`http://localhost/api/mobile/circles/${circleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: circleId }) }
  );

let db: CircleFakeDb;

function seed(startInDays: number, endInDays: number) {
  db = new CircleFakeDb();
  db.tables.fitcircles.push({
    id: CIRCLE,
    creator_id: CREATOR,
    name: 'Morning Crew',
    description: 'Up before the sun',
    type: 'weight_loss',
    status: startInDays > 0 ? 'upcoming' : 'active',
    visibility: 'private',
    start_date: stored(startInDays),
    end_date: stored(endInDays),
    participant_count: 2,
    invite_code: 'FITABC234',
  });
  setCircleDb(db);
  return db.tables.fitcircles[0];
}

const lastUpdate = () => db.log.filter((entry) => entry.op === 'update').at(-1)?.payload ?? {};

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ id: CREATOR });
});

describe('PUT /api/mobile/circles/[id]', () => {
  describe('description', () => {
    it('OLD: a non-empty description is stored as before', async () => {
      const circle = seed(5, 35);
      const res = await put({ description: 'New words' });

      expect(res.status).toBe(200);
      expect(circle.description).toBe('New words');
    });

    it('an empty string clears it', async () => {
      const circle = seed(5, 35);
      const res = await put({ description: '' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(circle.description).toBeNull();
      expect(body.data.description).toBeNull();
      expect(iosFitCircleProblems(body.data)).toEqual([]);
    });

    it('whitespace only clears it too', async () => {
      const circle = seed(5, 35);
      await put({ description: '   ' });
      expect(circle.description).toBeNull();
    });

    it('null is tolerated and changes nothing', async () => {
      const circle = seed(5, 35);
      const res = await put({ name: 'Renamed', description: null });

      expect(res.status).toBe(200);
      expect(circle.name).toBe('Renamed');
      expect(circle.description).toBe('Up before the sun');
      expect(Object.keys(lastUpdate())).not.toContain('description');
    });

    it('an omitted description changes nothing', async () => {
      const circle = seed(5, 35);
      await put({ name: 'Renamed' });
      expect(circle.description).toBe('Up before the sun');
    });
  });

  describe('what iOS 1.0 sends (always both dates)', () => {
    it('renaming an UPCOMING circle with unchanged dates succeeds', async () => {
      const circle = seed(5, 35);
      const res = await put({
        name: 'Renamed',
        description: 'Still early',
        start_date: asIos(circle.start_date),
        end_date: asIos(circle.end_date),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.meta).toBeNull();
      expect(circle.name).toBe('Renamed');
      expect(Object.keys(lastUpdate())).toEqual(
        expect.not.arrayContaining(['start_date', 'end_date', 'status'])
      );
      expect(iosEnvelopeProblems(body)).toEqual([]);
      expect(iosFitCircleProblems(body.data)).toEqual([]);
    });

    it('unchanged dates are not a change even on a circle that has STARTED', async () => {
      // Used to be 400 "Cannot change end date..." because end_date was present at all.
      const circle = seed(-2, 28);
      const res = await put({
        name: 'Renamed',
        start_date: asIos(circle.start_date),
        end_date: asIos(circle.end_date),
      });

      expect(res.status).toBe(200);
      expect(circle.name).toBe('Renamed');
    });

    it('tolerates the sub-second precision Swift drops', async () => {
      const circle = seed(-2, 28);
      circle.start_date = circle.start_date.replace('+00:00', '.789+00:00');
      circle.end_date = circle.end_date.replace('+00:00', '.123456+00:00');

      const res = await put({
        name: 'Renamed',
        start_date: asIos(circle.start_date),
        end_date: asIos(circle.end_date),
      });

      expect(res.status).toBe(200);
      expect((await res.json()).meta).toBeNull();
    });

    it('moving the end date of an upcoming circle is stored', async () => {
      const circle = seed(5, 35);
      const newEnd = asIos(stored(50));
      const res = await put({ start_date: asIos(circle.start_date), end_date: newEnd });

      expect(res.status).toBe(200);
      expect(circle.end_date).toBe(newEnd);
      expect(Object.keys(lastUpdate())).not.toContain('start_date');
    });
  });

  describe('end_date', () => {
    it('OLD: changing it after the start is still 400 VALIDATION_ERROR', async () => {
      const circle = seed(-2, 28);
      const before = circle.end_date;
      const res = await put({ end_date: asIos(stored(60)) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Cannot change end date for a circle that has already started');
      expect(circle.end_date).toBe(before);
    });

    it('an end before the start is 400, not a database error', async () => {
      const circle = seed(5, 35);
      const res = await put({ end_date: asIos(stored(2)) });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('End date must be after start date');
      expect(iosEnvelopeProblems(body)).toEqual([]);
      expect(circle.end_date).toBe(stored(35));
    });

    it('accepts a plain date and a zone offset', async () => {
      const circle = seed(5, 35);
      expect((await put({ end_date: '2031-01-15' })).status).toBe(200);
      expect(circle.end_date).toBe('2031-01-15');
      expect((await put({ end_date: '2031-02-15T00:00:00+02:00' })).status).toBe(200);
      expect(circle.end_date).toBe('2031-02-15T00:00:00+02:00');
    });
  });

  describe('start_date', () => {
    it('is applied while the circle is upcoming', async () => {
      const circle = seed(5, 35);
      const newStart = asIos(stored(10));
      const res = await put({ start_date: newStart });

      expect(res.status).toBe(200);
      expect(circle.start_date).toBe(newStart);
      expect(circle.status).toBe('upcoming');
      expect((await res.json()).meta).toBeNull();
    });

    it('moving it into the past makes the circle active', async () => {
      const circle = seed(5, 35);
      const res = await put({ start_date: asIos(stored(-1)) });

      expect(res.status).toBe(200);
      expect(circle.status).toBe('active');
    });

    it('is ignored, not rejected, once the circle has started', async () => {
      const circle = seed(-2, 28);
      const before = circle.start_date;
      const res = await put({ name: 'Renamed', start_date: asIos(stored(3)) });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(circle.start_date).toBe(before);
      expect(circle.name).toBe('Renamed');
      expect(body.meta).toEqual({ ignored_fields: ['start_date'] });
      expect(iosEnvelopeProblems(body)).toEqual([]);
    });

    it('a start after the end is 400', async () => {
      const circle = seed(5, 35);
      const res = await put({ start_date: asIos(stored(40)) });

      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toBe('End date must be after start date');
      expect(circle.start_date).toBe(stored(5));
    });

    it('accepts the camelCase alias', async () => {
      const circle = seed(5, 35);
      const newStart = asIos(stored(8));
      expect((await put({ startDate: newStart })).status).toBe(200);
      expect(circle.start_date).toBe(newStart);
    });
  });

  describe('permissions and validation are unchanged', () => {
    it('403 for anyone but the creator', async () => {
      const circle = seed(5, 35);
      requireMobileAuth.mockResolvedValue({ id: MEMBER });
      const res = await put({ name: 'Hijacked', description: '' });

      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
      expect(circle.name).toBe('Morning Crew');
      expect(circle.description).toBe('Up before the sun');
    });

    it('400 VALIDATION_ERROR keeps code + details and gains a readable message', async () => {
      seed(5, 35);
      const res = await put({ name: 'ab' });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(body.error.details)).toBe(true); // type unchanged
      expect(body.error.details[0].path).toEqual(['name']);
      expect(body.error.message).toMatch(/^name: /);
    });

    it('401 when unauthenticated', async () => {
      seed(5, 35);
      requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
      expect((await put({ name: 'Renamed' })).status).toBe(401);
    });
  });
});
