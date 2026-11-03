import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_AGE_HOURS,
  MAX_MAX_AGE_HOURS,
  type NudgeCandidate,
  emailAllowed,
  emailDisposition,
  ineligibleReason,
  onlyEmulatorDevices,
  planNudges,
  pushDisposition,
  resolveMaxAgeHours,
} from '../policy';

const NOW = new Date('2026-11-03T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const cand = (over: Partial<NudgeCandidate> = {}): NudgeCandidate => ({
  userId: 'u1',
  createdAt: hoursAgo(2),
  onboardingCompleted: false,
  isActive: true,
  email: 'person@gmail.com',
  preferences: {},
  metadata: {},
  hasPushToken: true,
  pushDelivered: new Set(),
  ...over,
});

const nudges = (state: Record<string, any>) => ({ onboarding_nudges: state });

describe('ineligibleReason', () => {
  it('needs onboarding unfinished, an active account and age between 1 h and the cutoff', () => {
    expect(ineligibleReason(cand(), NOW, 72)).toBeNull();
    expect(ineligibleReason(cand({ onboardingCompleted: null }), NOW, 72)).toBeNull();
    expect(ineligibleReason(cand({ onboardingCompleted: true }), NOW, 72)).toBe('onboarding_completed');
    expect(ineligibleReason(cand({ isActive: false }), NOW, 72)).toBe('inactive');
    expect(ineligibleReason(cand({ createdAt: hoursAgo(0.5) }), NOW, 72)).toBe('too_new');
    expect(ineligibleReason(cand({ createdAt: hoursAgo(73) }), NOW, 72)).toBe('too_old');
    // ops override for a one-off run
    expect(ineligibleReason(cand({ createdAt: hoursAgo(100) }), NOW, 120)).toBeNull();
  });

  it('resolveMaxAgeHours clamps the override', () => {
    expect(resolveMaxAgeHours(null)).toBe(DEFAULT_MAX_AGE_HOURS);
    expect(resolveMaxAgeHours('abc')).toBe(DEFAULT_MAX_AGE_HOURS);
    expect(resolveMaxAgeHours('-5')).toBe(DEFAULT_MAX_AGE_HOURS);
    expect(resolveMaxAgeHours('120')).toBe(120);
    expect(resolveMaxAgeHours('100000')).toBe(MAX_MAX_AGE_HOURS);
  });
});

describe('emailAllowed', () => {
  it('honours the marketing unsubscribe and the settings email toggle', () => {
    expect(emailAllowed(cand())).toBe(true);
    expect(emailAllowed(cand({ email: null }))).toBe(false);
    expect(emailAllowed(cand({ preferences: { marketingEmails: false } }))).toBe(false);
    expect(emailAllowed(cand({ preferences: { notifications: { email: false } } }))).toBe(false);
    expect(emailAllowed(cand({ preferences: { notifications: { email: true }, marketingEmails: true } }))).toBe(true);
  });
});

describe('planNudges — touch 1 (1 h – 24 h)', () => {
  it('push when the user has a token, with an email fallback if the push fails for good', () => {
    expect(planNudges(cand(), NOW).actions).toEqual([{ slot: 'push_1', channel: 'push', touch: 1, emailFallback: true }]);
    expect(planNudges(cand({ preferences: { marketingEmails: false } }), NOW).actions[0].emailFallback).toBe(false);
  });

  it('email instead when there is no push token', () => {
    expect(planNudges(cand({ hasPushToken: false }), NOW).actions).toEqual([{ slot: 'email_1', channel: 'email', touch: 1 }]);
  });

  it('nothing when there is neither a token nor email consent', () => {
    expect(planNudges(cand({ hasPushToken: false, email: null }), NOW)).toEqual({ actions: [], wait: 'touch_1_done' });
  });

  it('a recorded or delivered push 1 ends touch 1 (no email on top)', () => {
    const at = hoursAgo(1);
    expect(planNudges(cand({ metadata: nudges({ push_1: { status: 'sent', at } }) }), NOW).actions).toEqual([]);
    expect(planNudges(cand({ metadata: nudges({ push_1: { status: 'pending', at } }) }), NOW).actions).toEqual([]);
    expect(planNudges(cand({ pushDelivered: new Set([1 as const]) }), NOW).actions).toEqual([]);
  });

  it('a push 1 that failed for good (no device) falls back to email once', () => {
    const at = hoursAgo(1);
    const failed = nudges({ push_1: { status: 'failed', at, reason: 'no_delivery' } });
    expect(planNudges(cand({ metadata: failed }), NOW).actions).toEqual([{ slot: 'email_1', channel: 'email', touch: 1 }]);
    const both = nudges({ push_1: { status: 'failed', at }, email_1: { status: 'sent', at } });
    expect(planNudges(cand({ metadata: both }), NOW).actions).toEqual([]);
  });

  it('an email 1 already recorded is never resent', () => {
    const m = nudges({ email_1: { status: 'failed', at: hoursAgo(1), reason: 'validation_error' } });
    expect(planNudges(cand({ hasPushToken: false, metadata: m }), NOW).actions).toEqual([]);
  });
});

describe('planNudges — touch 2 (from 24 h)', () => {
  it('email + second push; touch 1 is abandoned once touch 2 is due', () => {
    expect(planNudges(cand({ createdAt: hoursAgo(25) }), NOW).actions).toEqual([
      { slot: 'push_2', channel: 'push', touch: 2 },
      { slot: 'email_2', channel: 'email', touch: 2 },
    ]);
  });

  it('only email without a token; only push without email consent', () => {
    expect(planNudges(cand({ createdAt: hoursAgo(25), hasPushToken: false }), NOW).actions.map((a) => a.slot)).toEqual(['email_2']);
    expect(planNudges(cand({ createdAt: hoursAgo(25), email: null }), NOW).actions.map((a) => a.slot)).toEqual(['push_2']);
  });

  it('waits 12 h after a late touch-1 send (e.g. a push held by quiet hours)', () => {
    const m = nudges({ push_1: { status: 'sent', at: hoursAgo(5) } });
    expect(planNudges(cand({ createdAt: hoursAgo(26), metadata: m }), NOW)).toEqual({ actions: [], wait: 'touch_2_gap' });
    const later = nudges({ push_1: { status: 'sent', at: hoursAgo(13) } });
    expect(planNudges(cand({ createdAt: hoursAgo(26), metadata: later }), NOW).actions).toHaveLength(2);
  });

  it('stops after touch 2 (max 2 per channel)', () => {
    const at = hoursAgo(3);
    const m = nudges({ push_1: { status: 'sent', at: hoursAgo(30) }, push_2: { status: 'sent', at }, email_2: { status: 'sent', at } });
    expect(planNudges(cand({ createdAt: hoursAgo(40), metadata: m }), NOW)).toEqual({ actions: [], wait: 'touch_2_done' });
    expect(planNudges(cand({ createdAt: hoursAgo(40), pushDelivered: new Set([2 as const]), metadata: nudges({ email_2: { status: 'sent', at } }) }), NOW).actions).toEqual([]);
  });
});

describe('outcomes', () => {
  it('push: sent / duplicate record as sent; final failures record + fall back; temporary holds release', () => {
    expect(pushDisposition({ sent: true })).toEqual({ kind: 'record', record: { status: 'sent' }, fallbackToEmail: false });
    expect(pushDisposition({ sent: false, reason: 'duplicate' })).toMatchObject({ kind: 'record', record: { status: 'sent' } });
    expect(pushDisposition({ sent: false, reason: 'no_delivery' })).toMatchObject({ kind: 'record', record: { status: 'failed' }, fallbackToEmail: true });
    expect(pushDisposition({ sent: false, reason: 'category_disabled' })).toMatchObject({ record: { status: 'suppressed' }, fallbackToEmail: true });
    for (const reason of ['quiet_hours', 'frequency_cap', 'suppressed_by_meal_reminder_dinner', 'burst']) {
      expect(pushDisposition({ sent: false, reason })).toEqual({ kind: 'release', reason });
    }
  });

  it('email: transient Resend errors release, permanent ones record failed', () => {
    expect(emailDisposition({ success: true, id: 'e1' })).toEqual({ kind: 'record', record: { status: 'sent', id: 'e1' } });
    expect(emailDisposition({ success: false, errorName: 'rate_limit_exceeded' })).toEqual({ kind: 'release', reason: 'rate_limit_exceeded' });
    expect(emailDisposition({ success: false, errorName: 'not_configured' }).kind).toBe('release');
    expect(emailDisposition({ success: false, errorName: 'validation_error' })).toEqual({ kind: 'record', record: { status: 'failed', reason: 'validation_error' } });
  });

  it('emulator-only devices', () => {
    expect(onlyEmulatorDevices(['Google sdk_gphone16k_arm64'])).toBe(true);
    expect(onlyEmulatorDevices(['Google sdk_gphone16k_arm64', 'samsung SM-S938U'])).toBe(false);
    expect(onlyEmulatorDevices([])).toBe(false);
    expect(onlyEmulatorDevices(['OnePlus OnePlus8Pro'])).toBe(false);
  });
});
