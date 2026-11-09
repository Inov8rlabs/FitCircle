import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { GET as CRON } from '../../../api/cron/trial-reminders/route';
import { NotificationOrchestrator, isCapExempt, TYPE_SCREEN_MAP, NOTIFICATION_TEMPLATES } from '../notification-orchestrator';
import { NotificationPreferencesService } from '../notification-preferences-service';
import { TrialReminderService, trialReminderDedupeKey } from '../trial-reminder-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

const NOW = new Date('2026-10-30T14:05:00Z'); // 10:05 Toronto
const U1 = '11111111-1111-4111-8111-111111111111';
let db: FakeSupabase;
let prefs: Record<string, any>;

const trialing = (id: string, over: Record<string, any> = {}) => ({
  id,
  timezone: 'America/Toronto',
  subscription_status: 'trialing',
  subscription_will_renew: true,
  trial_reminder_sent_at: null,
  trial_ends_at: '2026-10-31T18:05:00.000Z', // ends tomorrow 14:05 local → send today 10:00
  ...over,
});

beforeEach(() => {
  db = new FakeSupabase({ profiles: { uniqueKey: ['id'], rows: [trialing(U1)] } });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  prefs = { quiet_hours_start: '22:00', quiet_hours_end: '07:00', quiet_hours_timezone: 'America/Toronto' };
  vi.spyOn(NotificationPreferencesService, 'getPreferences').mockImplementation(async () => prefs as any);
  vi.spyOn(NotificationOrchestrator, 'send').mockResolvedValue({ sent: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('TrialReminderService.run', () => {
  it('sends trial_ending_reminder at ≈10:00 local the day before, with a dedupe key, and stamps the profile', async () => {
    const s = await TrialReminderService.run({ now: NOW });
    expect(s).toMatchObject({ enabled: true, candidates: 1, sent: 1 });
    expect(NotificationOrchestrator.send).toHaveBeenCalledWith(U1, 'trial_ending_reminder', {
      dedupeKey: trialReminderDedupeKey(U1, '2026-10-31T18:05:00.000Z'),
      trialEndsAt: '2026-10-31T18:05:00.000Z',
      endsPhrase: 'tomorrow',
    });
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBe(NOW.toISOString());
    // Next hourly run: already reminded → not a candidate.
    expect((await TrialReminderService.run({ now: new Date(NOW.getTime() + 3_600_000) })).candidates).toBe(0);
  });

  it('a trial ending early in the morning is reminded two local days before (≥ 24 h), naming the day', async () => {
    db.getRows('profiles')[0].trial_ends_at = '2026-11-01T11:00:00.000Z'; // Sun Nov 1 07:00 local (EST from 02:00)
    // Sat Oct 31 10:00 local would be 21 h before → too late for a 24 h lead → Fri Oct 30 10:00 (45 h).
    const s = await TrialReminderService.run({ now: NOW });
    expect(s).toMatchObject({ candidates: 1, sent: 1 });
    expect(NotificationOrchestrator.send).toHaveBeenCalledWith(U1, 'trial_ending_reminder', expect.objectContaining({ endsPhrase: 'on Sunday' }));
  });

  it('a 7-day trial is only a candidate inside the 50 h lookahead (no early reminder)', async () => {
    db.getRows('profiles')[0].trial_ends_at = '2026-11-05T18:05:00.000Z'; // 7-day trial started Oct 29
    expect((await TrialReminderService.run({ now: NOW })).candidates).toBe(0);
    expect((await TrialReminderService.run({ now: new Date('2026-11-04T14:05:00Z') })).skipped).toEqual({ not_yet: 1 }); // 09:05 EST
    expect((await TrialReminderService.run({ now: new Date('2026-11-04T15:05:00Z') })).sent).toBe(1); // 10:05 EST, 27 h before the end
  });

  it('too early → waits (no send, no stamp)', async () => {
    const s = await TrialReminderService.run({ now: new Date('2026-10-30T12:05:00Z') });
    expect(s).toMatchObject({ sent: 0, skipped: { not_yet: 1 } });
    expect(NotificationOrchestrator.send).not.toHaveBeenCalled();
  });

  it('quiet hours defer to a later run (late trial start inside quiet hours)', async () => {
    db.getRows('profiles')[0].trial_ends_at = '2026-10-31T16:00:00.000Z'; // ends 12:00 local; the 10:00 slot (Oct 30) was missed
    const night = new Date('2026-10-31T03:30:00Z'); // 23:30 local
    expect(await TrialReminderService.run({ now: night })).toMatchObject({ sent: 0, skipped: { quiet_hours: 1 } });
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBeNull();
    expect((await TrialReminderService.run({ now: new Date('2026-10-31T11:05:00Z') })).sent).toBe(1); // 07:05 local
  });

  it('skips cancelled trials (will_renew false), non-trialing users and trials ending outside the window', async () => {
    db.seed('profiles', [
      trialing('22222222-2222-4222-8222-222222222222', { subscription_will_renew: false }),
      trialing('33333333-3333-4333-8333-333333333333', { subscription_status: 'active' }),
      trialing('44444444-4444-4444-8444-444444444444', { trial_ends_at: '2026-11-05T00:00:00.000Z' }),
      trialing('55555555-5555-4555-8555-555555555555', { trial_ends_at: '2026-10-30T14:30:00.000Z' }),
    ]);
    expect((await TrialReminderService.run({ now: NOW })).candidates).toBe(1);
  });

  it('final non-delivery (no device) stamps; a retryable one does not', async () => {
    vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason: 'no_delivery' });
    await TrialReminderService.run({ now: NOW });
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBe(NOW.toISOString());
    db.getRows('profiles')[0].trial_reminder_sent_at = null;
    vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason: 'quiet_hours' });
    await TrialReminderService.run({ now: NOW });
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBeNull();
  });

  it('kill switch', async () => {
    vi.stubEnv('TRIAL_REMINDERS_ENABLED', 'false');
    expect(await TrialReminderService.run({ now: NOW })).toMatchObject({ enabled: false, candidates: 0 });
  });
});

describe('push policy for trial_ending_reminder', () => {
  it('cap-exempt, dashboard deep link, approved copy', () => {
    expect(isCapExempt('trial_ending_reminder')).toBe(true);
    expect(TYPE_SCREEN_MAP.trial_ending_reminder).toBe('dashboard');
    expect(NOTIFICATION_TEMPLATES.trial_ending_reminder({}).body).toBe(
      'Your FitCircle Pro trial ends tomorrow. Keep it, or cancel anytime in Settings → Subscriptions.'
    );
    expect(NOTIFICATION_TEMPLATES.trial_ending_reminder({ endsPhrase: 'on Friday' })).toMatchObject({
      title: 'Your trial ends on Friday',
      body: 'Your FitCircle Pro trial ends on Friday. Keep it, or cancel anytime in Settings → Subscriptions.',
    });
    // Anything unexpected falls back to the approved default.
    expect(NOTIFICATION_TEMPLATES.trial_ending_reminder({ endsPhrase: 'in <b>2</b> days' }).title).toBe('Your trial ends tomorrow');
  });

  it('category toggles never block it; the push master switch does', async () => {
    vi.spyOn(NotificationPreferencesService, 'getPreferences').mockResolvedValue({ journey_enabled: false } as any);
    vi.spyOn(NotificationPreferencesService, 'isPushMasterEnabled').mockResolvedValueOnce(true);
    expect(await NotificationPreferencesService.isTypeEnabled(U1, 'trial_ending_reminder')).toBe(true);
    expect(await NotificationPreferencesService.isTypeEnabled(U1, 'day1_nothing_logged')).toBe(false);
    vi.spyOn(NotificationPreferencesService, 'isPushMasterEnabled').mockResolvedValueOnce(false);
    expect(await NotificationPreferencesService.isTypeEnabled(U1, 'trial_ending_reminder')).toBe(false);
  });
});

describe('cron route', () => {
  it('requires CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'cs');
    expect((await CRON(new NextRequest('https://api.test/api/cron/trial-reminders'))).status).toBe(401);
    const ok = await CRON(new NextRequest('https://api.test/api/cron/trial-reminders', { headers: { authorization: 'Bearer cs' } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, enabled: true });
  });
});
