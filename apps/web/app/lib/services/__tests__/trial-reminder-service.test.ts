import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackServerEventInBackground } from '@/lib/analytics/amplitude-server';
import { sendEmail } from '@/lib/email/email-service';
import { cancelSteps, formatTrialEnd, trialReminderEmail } from '@/lib/email/trial-reminder-email';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { GET as CRON } from '../../../api/cron/trial-reminders/route';
import { NotificationOrchestrator, isCapExempt, TYPE_SCREEN_MAP, NOTIFICATION_TEMPLATES } from '../notification-orchestrator';
import { NotificationPreferencesService } from '../notification-preferences-service';
import { TrialReminderService, needsEmailFallback, trialDays, trialReminderDedupeKey, trialReminderEmailEnabled } from '../trial-reminder-service';
import { UserAudienceService } from '../user-audience-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/email/email-service', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/analytics/amplitude-server', async (orig) => ({ ...(await orig<typeof import('@/lib/analytics/amplitude-server')>()), trackServerEventInBackground: vi.fn() }));

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
  vi.mocked(sendEmail).mockReset().mockResolvedValue({ success: true, id: 'em_1' });
  vi.mocked(trackServerEventInBackground).mockReset();
  UserAudienceService.resetCache();
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

describe('email fallback (ENGAGEMENT_115_SPEC §14.1)', () => {
  const U2 = '22222222-2222-4222-8222-222222222222';
  const withEmail = (over: Record<string, any> = {}) => {
    const row = db.getRows('profiles')[0];
    Object.assign(row, {
      email: 'maya@gmail.com',
      is_admin: false,
      metadata: {},
      subscription_platform: 'app_store',
      subscription_product_id: 'fitcircle_pro_annual',
      trial_started_at: '2026-10-24T18:05:00.000Z', // 7-day trial
      ...over,
    });
  };

  it('push delivered → no email; stamped; Trial Reminder Sent {push, trial_days}', async () => {
    withEmail();
    const s = await TrialReminderService.run({ now: NOW });
    expect(s).toMatchObject({ sent: 1, emailed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBe(NOW.toISOString());
    expect(trackServerEventInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'Trial Reminder Sent', user_id: U1, event_properties: { channel: 'push', trial_days: 7 } }),
      expect.any(String)
    );
  });

  it.each([
    ['no_delivery (no token / every send failed)', 'no_delivery'],
    ['push master switch off', 'category_disabled'],
    ['suppressed for a non-quiet reason', 'suppressed_by_streak_lost'],
    ['frequency cap', 'frequency_cap'],
  ])('%s → email, stamped, channel email', async (_label, reason) => {
    withEmail();
    vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason });
    const s = await TrialReminderService.run({ now: NOW });
    expect(s).toMatchObject({ sent: 1, emailed: 1, skipped: {} });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(sendEmail).mock.calls[0][0];
    expect(arg).toMatchObject({
      to: 'maya@gmail.com',
      subject: 'Your FitCircle trial ends tomorrow',
      category: 'trial_reminder',
      idempotencyKey: trialReminderDedupeKey(U1, '2026-10-31T18:05:00.000Z'),
    });
    // End date in the user's zone (Toronto), the plan, App Store cancel steps, no invented price.
    expect(arg.text).toContain('Saturday, October 31 at 2:05 PM EDT');
    expect(arg.text).toContain('your annual plan starts and renews automatically');
    expect(arg.text).toContain('Settings → tap your name (Apple ID) → Subscriptions');
    expect(arg.text).not.toContain('Play Store');
    expect(arg.text).not.toMatch(/\$\d/);
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBe(NOW.toISOString());
    expect(trackServerEventInBackground).toHaveBeenCalledWith(expect.objectContaining({ event_properties: { channel: 'email', trial_days: 7 } }), expect.any(String));
  });

  it('quiet hours / deferred / duplicate never email', async () => {
    withEmail();
    for (const reason of ['quiet_hours', 'deferred', 'duplicate']) {
      db.getRows('profiles')[0].trial_reminder_sent_at = null;
      vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason });
      await TrialReminderService.run({ now: NOW });
    }
    expect(sendEmail).not.toHaveBeenCalled();
    expect(trackServerEventInBackground).not.toHaveBeenCalled();
  });

  it('kill switch TRIAL_REMINDER_EMAIL_ENABLED=false → no email; a final push outcome still stamps', async () => {
    vi.stubEnv('TRIAL_REMINDER_EMAIL_ENABLED', 'false');
    withEmail();
    vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason: 'no_delivery' });
    expect(await TrialReminderService.run({ now: NOW })).toMatchObject({ sent: 0, skipped: { 'no_delivery+email_disabled': 1 } });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBe(NOW.toISOString());
  });

  it('transient email failure → not stamped (next run retries); permanent failure on a final push → stamped', async () => {
    withEmail();
    vi.mocked(NotificationOrchestrator.send).mockResolvedValue({ sent: false, reason: 'no_delivery' });
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, errorName: 'rate_limit_exceeded' });
    expect((await TrialReminderService.run({ now: NOW })).skipped).toEqual({ 'no_delivery+email_rate_limit_exceeded': 1 });
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBeNull();
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, errorName: 'suppressed' });
    await TrialReminderService.run({ now: NOW });
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBe(NOW.toISOString());
    expect(trackServerEventInBackground).not.toHaveBeenCalled();
  });

  it('non-final push reason + permanent email failure → not stamped (push retried next run, as before)', async () => {
    withEmail({ email: null });
    vi.mocked(NotificationOrchestrator.send).mockResolvedValueOnce({ sent: false, reason: 'frequency_cap' });
    expect((await TrialReminderService.run({ now: NOW })).skipped).toEqual({ 'frequency_cap+email_no_address': 1 });
    expect(db.getRows('profiles')[0].trial_reminder_sent_at).toBeNull();
  });

  it('robot / QA test accounts get no email; internal accounts do, but no Amplitude event', async () => {
    withEmail({ email: 'robot@example.com' }); // qa
    vi.mocked(NotificationOrchestrator.send).mockResolvedValue({ sent: false, reason: 'no_delivery' });
    expect((await TrialReminderService.run({ now: NOW })).skipped).toEqual({ 'no_delivery+email_test_account': 1 });
    expect(sendEmail).not.toHaveBeenCalled();

    db.getRows('profiles')[0].trial_reminder_sent_at = null;
    withEmail({ email: 'team@fitcircle.ai' }); // internal
    expect(await TrialReminderService.run({ now: NOW })).toMatchObject({ sent: 1, emailed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(trackServerEventInBackground).not.toHaveBeenCalled();
  });

  it('Play / unknown store → matching cancel steps; monthly plan; unknown plan', async () => {
    db.seed('profiles', [trialing(U2, { email: 'b@gmail.com', subscription_platform: null, subscription_product_id: null })]);
    withEmail({ subscription_platform: 'play_store', subscription_product_id: 'pro_monthly:monthly' });
    vi.mocked(NotificationOrchestrator.send).mockResolvedValue({ sent: false, reason: 'no_delivery' });
    expect(await TrialReminderService.run({ now: NOW })).toMatchObject({ sent: 2, emailed: 2 });
    const [play, unknown] = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(play.text).toContain('Payments & subscriptions → Subscriptions');
    expect(play.text).not.toContain('Apple ID');
    expect(play.text).toContain('your monthly plan starts');
    expect(unknown.text).toContain('Apple ID');
    expect(unknown.text).toContain('Payments & subscriptions');
    expect(unknown.text).toContain('your FitCircle Pro subscription starts');
  });
});

describe('trial reminder helpers', () => {
  it('needsEmailFallback', () => {
    expect(needsEmailFallback({ sent: true })).toBe(false);
    for (const r of ['quiet_hours', 'deferred', 'duplicate']) expect(needsEmailFallback({ sent: false, reason: r })).toBe(false);
    for (const r of ['no_delivery', 'category_disabled', 'suppressed_by_x', 'unknown_type', undefined]) expect(needsEmailFallback({ sent: false, reason: r })).toBe(true);
  });
  it('trialReminderEmailEnabled defaults on', () => {
    expect(trialReminderEmailEnabled({} as any)).toBe(true);
    expect(trialReminderEmailEnabled({ TRIAL_REMINDER_EMAIL_ENABLED: 'off' } as any)).toBe(false);
    expect(trialReminderEmailEnabled({ TRIAL_REMINDER_EMAIL_ENABLED: 'true' } as any)).toBe(true);
  });
  it('trialDays', () => {
    expect(trialDays('2026-10-24T18:05:00Z', '2026-10-31T18:05:00Z')).toBe(7);
    expect(trialDays('2026-10-28T18:05:00Z', '2026-10-31T17:00:00Z')).toBe(3);
    expect(trialDays(null, '2026-10-31T18:05:00Z')).toBeUndefined();
    expect(trialDays('2026-11-01T00:00:00Z', '2026-10-31T18:05:00Z')).toBeUndefined();
  });
  it('template: price only when given; escaped; stripe → web billing', () => {
    const base = { trialEndsAt: new Date('2026-10-31T18:05:00Z'), timezone: 'Europe/London', endsPhrase: 'on Saturday', store: 'app_store' as const, plan: 'annual' as const, postalAddress: null };
    expect(trialReminderEmail({ ...base, price: '£29.99' }).text).toContain('your annual plan starts at £29.99/year');
    expect(trialReminderEmail(base).text).not.toContain('£');
    expect(trialReminderEmail({ ...base, price: '<b>1</b>' }).html).not.toContain('<b>1</b>');
    expect(formatTrialEnd(base.trialEndsAt, 'Europe/London')).toBe('Saturday, October 31 at 6:05 PM GMT');
    expect(cancelSteps('stripe')[0].url).toBe('https://www.fitcircle.ai/settings/billing');
    expect(trialReminderEmail(base).subject).toBe('Your FitCircle trial ends on Saturday');
  });
});
