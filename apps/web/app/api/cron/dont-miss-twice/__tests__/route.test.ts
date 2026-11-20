/**
 * /api/cron/dont-miss-twice (auth, kill switch, dry run) and the nightly streak cron's
 * streak_lost / shield_applied retirement (docs/ENGAGEMENT_115_SPEC.md §5.2, §13.4).
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ runs: [] as any[], sends: [] as any[], outcome: null as any }));
vi.mock('@/lib/services/dont-miss-twice-service', () => ({
  DontMissTwiceService: {
    run: async (opts: any) => {
      h.runs.push(opts);
      return { enabled: true, dryRun: !!opts.dryRun, candidates: 1, sent: 0, byType: {}, skipped: {}, decisions: [{ userId: 'u1', type: 'streak_save_offer' }] };
    },
  },
}));
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => {
      const q: any = {
        select: () => q, gt: () => q, or: () => q, order: () => q,
        range: async () => ({ data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/services/streak-claiming-service', () => ({
  StreakClaimingService: { checkAndBreakStreak: async (id: string) => (id === 'u1' ? { broken: true, lostStreak: 5, paywallEligible: true } : { broken: false, shieldApplied: true, currentStreak: 9, shieldsRemaining: 1 }) },
}));
vi.mock('@/lib/services/notification-orchestrator', () => ({
  NotificationOrchestrator: { send: async (...a: any[]) => (h.sends.push(a), { sent: true }) },
}));

import { runDailyStreakCheck } from '@/lib/cron/streak-daily-check';

import { GET } from '../route';

const req = (qs = '', auth = 'Bearer s3cret') => new NextRequest(`https://x/api/cron/dont-miss-twice${qs}`, { headers: { authorization: auth } });

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret';
  h.runs = [];
  h.sends = [];
});
afterEach(() => {
  delete process.env.DONT_MISS_TWICE_PUSH_ENABLED;
});

describe('GET /api/cron/dont-miss-twice', () => {
  it('401 without the cron secret (fail closed)', async () => {
    expect((await GET(req('', 'Bearer nope'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(req())).status).toBe(401);
  });

  it('kill switch off (the default): a real run does nothing; a dry run still answers', async () => {
    expect(await (await GET(req())).json()).toEqual({ success: true, disabled: true });
    expect(h.runs).toEqual([]);
    const dry = await (await GET(req('?dry_run=1&all_hours=1&userId=11111111-1111-4111-8111-111111111111&as_of=2026-11-13T14:10:00Z'))).json();
    expect(dry).toMatchObject({ success: true, dryRun: true, decisions: [{ userId: 'u1' }] });
    expect(h.runs[0]).toMatchObject({ dryRun: true, allHours: true, userIds: ['11111111-1111-4111-8111-111111111111'], now: new Date('2026-11-13T14:10:00Z') });
  });

  it('enabled: real run; as_of is dry-run only; bad userId → 400', async () => {
    process.env.DONT_MISS_TWICE_PUSH_ENABLED = 'true';
    expect((await GET(req())).status).toBe(200);
    expect(h.runs[0]).toMatchObject({ dryRun: false, allHours: false });
    expect((await GET(req('?as_of=2026-11-13T00:00:00Z'))).status).toBe(400);
    expect((await GET(req('?dry_run=1&userId=nope'))).status).toBe(400);
  });
});

describe('nightly streak cron: night pushes', () => {
  const nightly = () => runDailyStreakCheck(new NextRequest('https://x/api/cron/streaks/daily-check', { headers: { authorization: 'Bearer s3cret' } }));

  it('DONT_MISS_TWICE_PUSH_ENABLED off → streak_lost / shield_applied are sent as before', async () => {
    const body = await (await nightly()).json();
    expect(body.stats).toMatchObject({ streaks_broken: 1, shields_applied: 1, night_pushes: true, notified: 2 });
    expect(h.sends.map((s) => s[1]).sort()).toEqual(['shield_applied', 'streak_lost']);
  });

  it('on → protect-or-break still runs, but the night pushes are retired (the D+1 push carries the state)', async () => {
    process.env.DONT_MISS_TWICE_PUSH_ENABLED = 'true';
    const body = await (await nightly()).json();
    expect(body.stats).toMatchObject({ streaks_broken: 1, shields_applied: 1, night_pushes: false, notified: 0 });
    expect(h.sends).toEqual([]);
  });
});
