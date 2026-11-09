/**
 * The 15-minute meal-reminders cron also runs the quiet-hours release and the
 * Day-1 morning push (in that order), each failure-isolated.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Day1MorningPushService } from '@/lib/services/day1-morning-push-service';
import { DeferredNudgeService } from '@/lib/services/deferred-nudge-service';
import { MealReminderService } from '@/lib/services/meal-reminder-service';

import { GET } from '../route';

const call = (auth = 'Bearer cron') => GET(new NextRequest('https://www.fitcircle.ai/api/cron/meal-reminders', { headers: { authorization: auth } }));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /api/cron/meal-reminders', () => {
  it('401 without the cron secret', async () => {
    expect((await call('Bearer nope')).status).toBe(401);
  });

  it('runs release → Day-1 → meal reminders, in that order', async () => {
    const order: string[] = [];
    vi.spyOn(DeferredNudgeService, 'releaseDue').mockImplementation(async () => (order.push('deferred'), { heldUsers: 0, released: 0, sent: 0, closed: {}, notSent: {} }));
    vi.spyOn(Day1MorningPushService, 'run').mockImplementation(async () => (order.push('day1'), { enabled: true, candidates: 0, due: 0, sent: 0, skipped: {}, variants: {} }));
    vi.spyOn(MealReminderService, 'run').mockImplementation(async () => (order.push('meal'), { enabled: true, candidates: 0, due: 0, sent: 0, skipped: {}, bySlot: {} }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(order).toEqual(['deferred', 'day1', 'meal']);
    expect(await res.json()).toMatchObject({ success: true, deferred: { released: 0 }, day1: { sent: 0 }, sent: 0 });
  });

  it('a failing release or Day-1 pass never stops the meal reminders', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(DeferredNudgeService, 'releaseDue').mockRejectedValue(new Error('db down'));
    vi.spyOn(Day1MorningPushService, 'run').mockRejectedValue(new Error('boom'));
    const meal = vi.spyOn(MealReminderService, 'run').mockResolvedValue({ enabled: true, candidates: 1, due: 1, sent: 1, skipped: {}, bySlot: { lunch: 1 } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(meal).toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ success: true, sent: 1, deferred: { error: 'db down' }, day1: { error: 'boom' } });
  });
});
