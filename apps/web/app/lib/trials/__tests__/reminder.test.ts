import { describe, expect, it } from 'vitest';

import { decideTrialReminder, localWallTimeToUtc, reminderSendAt } from '../reminder';

const iso = (d: Date) => d.toISOString();

describe('reminderSendAt: 10:00 local the day before the trial ends', () => {
  it('trial ending mid-afternoon → 10:00 the previous local day (28 h lead)', () => {
    // Toronto (EDT, UTC−4 until Nov 1 2026): ends Oct 31 14:05 local.
    const ends = new Date('2026-10-31T18:05:00Z');
    expect(iso(reminderSendAt(ends, 'America/Toronto'))).toBe('2026-10-30T14:00:00.000Z');
  });

  it('trial ending early morning → still the previous local day (lead ≥ 14 h)', () => {
    // ends Oct 31 03:00 Toronto → Oct 30 10:00 is 17 h before.
    expect(iso(reminderSendAt(new Date('2026-10-31T07:00:00Z'), 'America/Toronto'))).toBe('2026-10-30T14:00:00.000Z');
  });

  it('trial ending just after midnight → previous day 10:00 (14 h lead at the limit)', () => {
    // ends Oct 31 00:00 Toronto exactly → Oct 30 10:00 is exactly 14 h before.
    expect(iso(reminderSendAt(new Date('2026-10-31T04:00:00Z'), 'America/Toronto'))).toBe('2026-10-30T14:00:00.000Z');
  });

  it('handles DST (America/New_York switches Nov 1 2026)', () => {
    // ends Nov 2 14:00 EST (19:00Z) → Nov 1 10:00 EST = 15:00Z.
    expect(iso(reminderSendAt(new Date('2026-11-02T19:00:00Z'), 'America/New_York'))).toBe('2026-11-01T15:00:00.000Z');
    expect(iso(localWallTimeToUtc('2026-11-01', 10, 'America/New_York'))).toBe('2026-11-01T15:00:00.000Z');
    expect(iso(localWallTimeToUtc('2026-10-31', 10, 'America/New_York'))).toBe('2026-10-31T14:00:00.000Z');
  });

  it('works east of UTC and on half-hour zones', () => {
    // Kolkata UTC+5:30: ends Nov 3 12:00 IST (06:30Z) → Nov 2 10:00 IST = 04:30Z.
    expect(iso(reminderSendAt(new Date('2026-11-03T06:30:00Z'), 'Asia/Kolkata'))).toBe('2026-11-02T04:30:00.000Z');
  });
});

describe('decideTrialReminder', () => {
  const tz = 'America/Toronto';
  const ends = new Date('2026-10-31T18:05:00Z'); // send at 2026-10-30T14:00Z

  it('waits until the send time', () => {
    expect(decideTrialReminder({ now: new Date('2026-10-30T13:05:00Z'), trialEndsAt: ends, timezone: tz, inQuietHours: false })).toMatchObject({ send: false, skip: 'not_yet' });
  });

  it('sends at/after the send time', () => {
    expect(decideTrialReminder({ now: new Date('2026-10-30T14:05:00Z'), trialEndsAt: ends, timezone: tz, inQuietHours: false })).toMatchObject({ send: true });
  });

  it('missed the slot (late trial / outage) → sends immediately when ≥ 1 h remains', () => {
    expect(decideTrialReminder({ now: new Date('2026-10-31T12:00:00Z'), trialEndsAt: ends, timezone: tz, inQuietHours: false })).toMatchObject({ send: true });
  });

  it('quiet hours defer; under an hour left gives up', () => {
    expect(decideTrialReminder({ now: new Date('2026-10-31T03:00:00Z'), trialEndsAt: ends, timezone: tz, inQuietHours: true })).toMatchObject({ send: false, skip: 'quiet_hours' });
    expect(decideTrialReminder({ now: new Date('2026-10-31T17:30:00Z'), trialEndsAt: ends, timezone: tz, inQuietHours: false })).toMatchObject({ send: false, skip: 'too_late' });
  });
});
