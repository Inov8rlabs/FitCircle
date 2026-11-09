import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTIFICATION_TZ, isPlaceholderTimezone, localClockIn, resolveNotificationTimezone } from '../user-timezone';

describe('isPlaceholderTimezone', () => {
  it('treats empty, invalid and UTC-style defaults as placeholders', () => {
    for (const tz of [null, undefined, '', '  ', 'UTC', 'Etc/UTC', 'GMT', 'Not/AZone']) expect(isPlaceholderTimezone(tz as any), String(tz)).toBe(true);
  });
  it('real device zones are not placeholders (Europe/London is not UTC)', () => {
    for (const tz of ['America/Chicago', 'Asia/Kolkata', 'Europe/London', 'America/New_York']) expect(isPlaceholderTimezone(tz)).toBe(false);
  });
});

describe('resolveNotificationTimezone', () => {
  it('a quiet-hours zone the user changed wins', () => {
    expect(resolveNotificationTimezone({ quietHoursTimezone: 'America/Chicago', profileTimezone: 'Asia/Kolkata' })).toBe('America/Chicago');
  });
  it('the untouched New York preference default yields to the device zone on the profile', () => {
    expect(resolveNotificationTimezone({ quietHoursTimezone: 'America/New_York', profileTimezone: 'Asia/Kolkata' })).toBe('Asia/Kolkata');
  });
  it('profile UTC is a placeholder: falls to the streak-claim zone, then the preference default', () => {
    expect(resolveNotificationTimezone({ quietHoursTimezone: 'America/New_York', profileTimezone: 'UTC', claimTimezone: 'America/Denver' })).toBe('America/Denver');
    expect(resolveNotificationTimezone({ quietHoursTimezone: 'America/New_York', profileTimezone: 'UTC' })).toBe('America/New_York');
    expect(resolveNotificationTimezone({})).toBe(DEFAULT_NOTIFICATION_TZ);
  });
});

describe('localClockIn', () => {
  it('local date and minutes', () => {
    expect(localClockIn(new Date('2026-11-09T14:30:00Z'), 'America/Chicago')).toEqual({ date: '2026-11-09', minutes: 8 * 60 + 30 });
    expect(localClockIn(new Date('2026-11-09T20:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-11-10', minutes: 1 * 60 + 30 });
  });
});
