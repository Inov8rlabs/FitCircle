import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendEmail } from '@/lib/email/email-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { GET as CRON } from '../../../api/cron/onboarding-nudges/route';
import { NOTIFICATION_TEMPLATES, NotificationOrchestrator, TYPE_SCREEN_MAP, isCapChecked, isCapExempt } from '../notification-orchestrator';
import { NotificationPreferencesService } from '../notification-preferences-service';
import { OnboardingNudgeService } from '../onboarding-nudge-service';
import { isTestDeviceRequest, recordTestDeviceSignal } from '../test-device-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/email/email-service', () => ({ sendEmail: vi.fn() }));

const NOW = new Date('2026-11-03T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

let db: FakeSupabase;

const profile = (id: string, over: Record<string, any> = {}) => ({
  id,
  email: `${id.slice(0, 4)}person@gmail.com`,
  created_at: hoursAgo(2),
  onboarding_completed: false,
  onboarding_flow: 'v3',
  is_admin: false,
  is_active: true,
  preferences: {},
  metadata: {},
  ...over,
});
const token = (userId: string, device_name = 'samsung SM-S938U') => ({ user_id: userId, device_name, is_active: true });
const nudges = (id: string) => db.getRows('profiles').find((p) => p.id === id)?.metadata?.onboarding_nudges ?? {};

beforeEach(() => {
  db = new FakeSupabase({
    profiles: { uniqueKey: ['id'], rows: [] },
    push_tokens: { rows: [] },
    notification_log: { rows: [] },
    user_attribution: { rows: [] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  vi.spyOn(NotificationOrchestrator, 'send').mockResolvedValue({ sent: true });
  vi.mocked(sendEmail).mockResolvedValue({ success: true, id: 'email-1' });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(sendEmail).mockReset();
  vi.unstubAllEnvs();
});

describe('notification catalog', () => {
  it('onboarding_finish_reminder is a journey nudge that counts toward and respects the daily cap', () => {
    expect(NOTIFICATION_TEMPLATES.onboarding_finish_reminder({ touch: 1 })).toEqual({
      title: 'Your plan is almost ready',
      body: '2 minutes left to finish setting up FitCircle.',
      category: 'journey',
    });
    expect(NOTIFICATION_TEMPLATES.onboarding_finish_reminder({ touch: 2 }).title).toBe('Your plan is still waiting');
    expect(NotificationPreferencesService.getCategoryForType('onboarding_finish_reminder')).toBe('journey');
    expect(TYPE_SCREEN_MAP.onboarding_finish_reminder).toBe('dashboard');
    expect(isCapExempt('onboarding_finish_reminder')).toBe(false);
    expect(isCapChecked('onboarding_finish_reminder')).toBe(true);
  });
});

describe('OnboardingNudgeService.run', () => {
  it('touch 1: push with a dedupe key, recorded once; a re-run sends nothing', async () => {
    db.seed('profiles', [profile(U1)]);
    db.seed('push_tokens', [token(U1)]);

    const s = await OnboardingNudgeService.run({ now: NOW });
    expect(s).toMatchObject({ candidates: 1, sent: { push_1: 1 } });
    expect(NotificationOrchestrator.send).toHaveBeenCalledWith(U1, 'onboarding_finish_reminder', {
      touch: 1,
      dedupeKey: `onboarding_finish:${U1}:1`,
    });
    expect(nudges(U1).push_1).toEqual({ status: 'sent', at: NOW.toISOString() });
    expect(sendEmail).not.toHaveBeenCalled();

    const again = await OnboardingNudgeService.run({ now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(again.sent).toEqual({});
    expect(NotificationOrchestrator.send).toHaveBeenCalledTimes(1);
  });

  it('touch 1 without a push token: email with unsubscribe headers + idempotency key', async () => {
    db.seed('profiles', [profile(U1)]);
    const s = await OnboardingNudgeService.run({ now: NOW });
    expect(s.sent).toEqual({ email_1: 1 });
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.subject).toBe('Your plan is almost ready');
    expect(call.html).toContain('https://fitcircle.ai/open?');
    expect(call.html).toContain('utm_campaign=finish_setup');
    expect(call.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/www\.fitcircle\.ai\/api\/campaigns\/unsubscribe\?t=/);
    expect(call.idempotencyKey).toBe(`onboarding-finish/${U1}/1`);
    expect(nudges(U1).email_1).toEqual({ status: 'sent', at: NOW.toISOString(), id: 'email-1' });
  });

  it('push with no deliverable device falls back to email in the same run', async () => {
    db.seed('profiles', [profile(U1)]);
    db.seed('push_tokens', [token(U1)]);
    vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason: 'no_delivery' });
    const s = await OnboardingNudgeService.run({ now: NOW });
    expect(s).toMatchObject({ sent: { email_1: 1 }, notSent: { 'push_1:no_delivery': 1 } });
    expect(nudges(U1).push_1.status).toBe('failed');
    expect(nudges(U1).email_1.status).toBe('sent');
  });

  it('quiet hours / daily cap: the claim is released and a later run retries', async () => {
    db.seed('profiles', [profile(U1)]);
    db.seed('push_tokens', [token(U1)]);
    vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason: 'quiet_hours' });
    expect((await OnboardingNudgeService.run({ now: NOW })).notSent).toEqual({ 'push_1:quiet_hours': 1 });
    expect(nudges(U1).push_1).toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();

    expect((await OnboardingNudgeService.run({ now: later(1) })).sent).toEqual({ push_1: 1 });
  });

  it('transient email errors release; permanent ones are recorded and never retried', async () => {
    db.seed('profiles', [profile(U1)]);
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, errorName: 'rate_limit_exceeded' });
    await OnboardingNudgeService.run({ now: NOW });
    expect(nudges(U1).email_1).toBeUndefined();

    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, errorName: 'validation_error' });
    await OnboardingNudgeService.run({ now: later(0.25) });
    expect(nudges(U1).email_1).toMatchObject({ status: 'failed', reason: 'validation_error' });
    await OnboardingNudgeService.run({ now: later(0.5) });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('full lifecycle: push at 1 h, push + email at 24 h, then nothing (max 2 per channel)', async () => {
    db.seed('profiles', [profile(U1, { created_at: hoursAgo(1) })]);
    db.seed('push_tokens', [token(U1)]);
    for (let h = 0; h <= 96; h += 0.25) {
      if (Date.parse(hoursAgo(1)) + 72 * 3_600_000 < later(h).getTime()) break;
      await OnboardingNudgeService.run({ now: later(h) });
    }
    const sends = vi.mocked(NotificationOrchestrator.send).mock.calls.map((c) => (c[2] as any).touch);
    expect(sends).toEqual([1, 2]);
    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0].idempotencyKey)).toEqual([`onboarding-finish/${U1}/2`]);
    expect(Object.keys(nudges(U1)).sort()).toEqual(['email_2', 'push_1', 'push_2']);
  });

  it('a delivered notification_log row counts as sent even if metadata lost the record', async () => {
    db.seed('profiles', [profile(U1)]);
    db.seed('push_tokens', [token(U1)]);
    db.seed('notification_log', [{ user_id: U1, notification_type: 'onboarding_finish_reminder', suppressed: false, data: { touch: 1 } }]);
    const s = await OnboardingNudgeService.run({ now: NOW });
    expect(s.waiting).toEqual({ touch_1_done: 1 });
    expect(NotificationOrchestrator.send).not.toHaveBeenCalled();
  });

  it('never messages finished, old, test or internal accounts', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `${String(i + 3).repeat(8)}-0000-4000-8000-000000000000`);
    db.seed('profiles', [
      profile(ids[0], { onboarding_completed: true }),
      profile(ids[1], { created_at: hoursAgo(80) }), // older than the 72 h cutoff
      profile(ids[2], { email: 'jamesmiller.12345@gmail.com' }), // Play pre-launch tester shape
      profile(ids[3], { email: 'robot@cloudtestlabaccounts.com' }),
      profile(ids[4], { email: 'dev@fitcircle.ai' }),
      profile(ids[5], { is_admin: true }),
      profile(ids[6], { metadata: { test_device: { at: NOW.toISOString(), source: 'header' } } }),
      profile(ids[7]), // only an emulator device
      profile(ids[8], { created_at: hoursAgo(0.5) }), // too new: outside the query window
    ]);
    db.seed('push_tokens', [token(ids[7], 'Google sdk_gphone16k_arm64')]);
    const s = await OnboardingNudgeService.run({ now: NOW });
    expect(s.excluded).toEqual({
      'test:play_testers': 1,
      'test:test_lab': 1,
      'test:internal': 2,
      'test:test_device': 1,
      'test:emulator': 1,
    });
    expect(s.candidates).toBe(6); // completed, 80 h and 0.5 h accounts aren't even read
    expect(NotificationOrchestrator.send).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('respects the email opt-out', async () => {
    db.seed('profiles', [profile(U1, { preferences: { marketingEmails: false } })]);
    const s = await OnboardingNudgeService.run({ now: NOW });
    expect(s.waiting).toEqual({ touch_1_done: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('maxAgeHours widens the cutoff for a deliberate one-off run (they get touch 2 only)', async () => {
    db.seed('profiles', [profile(U1, { created_at: hoursAgo(100) })]);
    db.seed('push_tokens', [token(U1)]);
    expect((await OnboardingNudgeService.run({ now: NOW })).candidates).toBe(0);
    const s = await OnboardingNudgeService.run({ now: NOW, maxAgeHours: 120 });
    expect(s.sent).toEqual({ push_2: 1, email_2: 1 });
  });

  it('dry run: plans without writing or sending; the kill switch stops real runs', async () => {
    db.seed('profiles', [profile(U1), profile(U2, { created_at: hoursAgo(30) })]);
    db.seed('push_tokens', [token(U1)]);
    const s = await OnboardingNudgeService.run({ now: NOW, dryRun: true });
    expect(s.planned).toEqual([
      { user: U2.slice(0, 8), ageHours: 30, flow: 'v3', slots: ['email_2'] },
      { user: U1.slice(0, 8), ageHours: 2, flow: 'v3', slots: ['push_1'] },
    ]);
    expect(NotificationOrchestrator.send).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(nudges(U1)).toEqual({});

    vi.stubEnv('ONBOARDING_NUDGES_ENABLED', 'false');
    expect(await OnboardingNudgeService.run({ now: NOW })).toMatchObject({ enabled: false, candidates: 0 });
    vi.stubEnv('ONBOARDING_NUDGES_ENABLED', '');
    vi.stubEnv('ONBOARDING_NUDGES_DRY_RUN', 'true');
    expect((await OnboardingNudgeService.run({ now: NOW })).dryRun).toBe(true);
    expect(NotificationOrchestrator.send).not.toHaveBeenCalled();
  });

  it('a claim is exclusive and refused once onboarding is completed', async () => {
    db.seed('profiles', [profile(U1)]);
    expect(await OnboardingNudgeService.claim(U1, 'push_1', NOW)).toBe(true);
    expect(await OnboardingNudgeService.claim(U1, 'push_1', NOW)).toBe(false);
    db.getRows('profiles')[0].onboarding_completed = true;
    expect(await OnboardingNudgeService.claim(U1, 'email_1', NOW)).toBe(false);
  });
});

describe('GET /api/cron/onboarding-nudges', () => {
  const req = (qs = '', auth = 'Bearer s3cret') =>
    new NextRequest(`https://www.fitcircle.ai/api/cron/onboarding-nudges${qs}`, { headers: { authorization: auth } });

  it('fails closed without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await CRON(req())).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await CRON(req('', 'Bearer nope'))).status).toBe(401);
  });

  it('passes dryRun / maxAgeHours / flow / userId through, validating them', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    const run = vi.spyOn(OnboardingNudgeService, 'run').mockResolvedValue({} as any);
    expect((await CRON(req(`?dryRun=1&maxAgeHours=9999&flow=v3&userId=${U1}`))).status).toBe(200);
    expect(run).toHaveBeenCalledWith({ userId: U1, flow: 'v3', maxAgeHours: 336, dryRun: true });
    expect((await CRON(req('?userId=nope'))).status).toBe(400);
    expect((await CRON(req('?flow=drop'))).status).toBe(400);
  });
});

describe('test device signal (X-Test-Device: 1)', () => {
  it('flags the account once; no header → no write', async () => {
    db.seed('profiles', [profile(U1, { metadata: { milestones: { x: 1 } } })]);
    expect(isTestDeviceRequest(new Headers({ 'X-Test-Device': '1' }))).toBe(true);
    expect(isTestDeviceRequest(new Headers({ 'X-Test-Device': '0' }))).toBe(false);

    expect(await recordTestDeviceSignal(U1, new Headers())).toBe(false);
    expect(db.getRows('profiles')[0].metadata.test_device).toBeUndefined();

    expect(await recordTestDeviceSignal(U1, new Headers({ 'X-Test-Device': '1' }))).toBe(true);
    expect(db.getRows('profiles')[0].metadata).toMatchObject({ milestones: { x: 1 }, test_device: { source: 'header' } });
  });
});
