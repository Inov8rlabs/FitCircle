import { describe, expect, it } from 'vitest';

import {
  MAX_CONTACTS_PER_SEND,
  addChips,
  chipsToContacts,
  mergeFriends,
  normalizePhone,
  nudgeAnalytics,
  nudgeView,
  parseContact,
  resultCopy,
  smsHref,
  splitContactInput,
  untilLabel,
  type HubInviteRow,
  type HubInviteeRow,
} from '../invite-form';

describe('parseContact (smart field)', () => {
  it('accepts and lowercases emails', () => {
    expect(parseContact(' Sam@Example.COM ')).toEqual({ kind: 'email', value: 'sam@example.com' });
    expect(parseContact('mailto:jo@x.io')).toEqual({ kind: 'email', value: 'jo@x.io' });
  });

  it('rejects malformed emails', () => {
    expect(parseContact('sam@')).toMatchObject({ kind: 'invalid' });
    expect(parseContact('sam@example')).toMatchObject({ kind: 'invalid' });
    expect(parseContact('a b@x.com')).toMatchObject({ kind: 'invalid' });
  });

  it('normalizes phones to E.164', () => {
    expect(parseContact('+44 7700 900123')).toMatchObject({ kind: 'phone', value: '+447700900123' });
    expect(parseContact('(416) 555-0123')).toMatchObject({ kind: 'phone', value: '+14165550123', display: '(416) 555-0123' });
    expect(parseContact('1-416-555-0123')).toMatchObject({ kind: 'phone', value: '+14165550123' });
    expect(parseContact('tel:+14165550123')).toMatchObject({ kind: 'phone', value: '+14165550123' });
  });

  it('asks for a country code on ambiguous non-NANP numbers', () => {
    expect(parseContact('07700 900123')).toEqual({ kind: 'invalid', input: '07700 900123', reason: 'Add the country code, like +44…' });
    expect(parseContact('123')).toMatchObject({ kind: 'invalid' });
    expect(parseContact('hello')).toMatchObject({ kind: 'invalid' });
    expect(parseContact('')).toMatchObject({ kind: 'invalid' });
  });

  it('normalizePhone bounds', () => {
    expect(normalizePhone('+1234567')).toBeNull();
    expect(normalizePhone('+1234567890123456')).toBeNull();
    expect(normalizePhone('+12345678')).toBe('+12345678');
    expect(normalizePhone('416-555-abcd')).toBeNull();
  });
});

describe('chips', () => {
  it('splits pasted lists', () => {
    expect(splitContactInput('a@x.com, b@y.com;\n+14165550123')).toEqual(['a@x.com', 'b@y.com', '+14165550123']);
  });

  it('adds, dedupes and attaches a name only to a single entry', () => {
    let r = addChips([], 'sam@x.com', 'Sam');
    expect(r.chips).toEqual([{ key: 'email:sam@x.com', kind: 'email', value: 'sam@x.com', label: 'sam@x.com', name: 'Sam' }]);
    r = addChips(r.chips, 'SAM@x.com');
    expect(r.chips).toHaveLength(1);
    r = addChips(r.chips, 'a@x.com, b@x.com', 'Ignored');
    expect(r.chips.slice(1).every((c) => c.name === undefined)).toBe(true);
  });

  it('returns invalid entries and caps at 10', () => {
    const many = Array.from({ length: 12 }, (_, i) => `p${i}@x.com`).join(',');
    const r = addChips([], `${many}, nope`);
    expect(r.chips).toHaveLength(MAX_CONTACTS_PER_SEND);
    expect(r.rejected.map((x) => x.input)).toEqual(['p10@x.com', 'p11@x.com', 'nope']);
  });

  it('builds the request contacts', () => {
    const { chips } = addChips([], 'sam@x.com, +14165550123');
    expect(chipsToContacts(chips)).toEqual([
      { email: 'sam@x.com', channel: 'email' },
      { phone: '+14165550123', channel: 'sms' },
    ]);
  });

  it('builds sms: links understood by iOS and Android', () => {
    expect(smsHref('Join me: https://x.y/i/A?b=1 💪', '+14165550123')).toBe(
      `sms:+14165550123?&body=${encodeURIComponent('Join me: https://x.y/i/A?b=1 💪')}`
    );
    expect(smsHref('hi')).toBe('sms:?&body=hi');
  });

  it('maps result statuses to copy, defaulting unknown to failed', () => {
    expect(resultCopy('opted_out').label).toBe("Can't invite this address");
    expect(resultCopy('sent').tone).toBe('good');
    expect(resultCopy('weird').label).toBe(resultCopy('failed').label);
  });
});

describe('merged friends list', () => {
  const invites: HubInviteRow[] = [
    { id: 'i1', channel: 'email', name: 'Sam', contact: 'sa•••@x.com', status: 'invited', sentAt: 'x', lastNudgedAt: null, nudge: { available: true, nextAt: null, remaining: 2 } },
    { id: 'i2', channel: 'sms', name: null, contact: '•••• 0123', status: 'invited', sentAt: 'x', lastNudgedAt: null },
    { id: 'i3', channel: 'email', name: 'Old', contact: 'o•••@x.com', status: 'joined', sentAt: 'x', lastNudgedAt: null },
  ];
  const invitees: HubInviteeRow[] = [
    { id: 'r1', displayName: 'Jo', avatarUrl: null, status: 'pending', joinedAt: 'x', qualifiedAt: null, circleName: 'Morning Movers', nudge: { available: false, nextAt: null, remaining: 0 } },
    { id: 'r2', displayName: 'Lee', avatarUrl: null, status: 'qualified', joinedAt: 'x', qualifiedAt: 'y', circleName: null },
  ];

  it('puts invites first, drops converted invites, maps statuses', () => {
    const rows = mergeFriends(invites, invitees);
    expect(rows.map((r) => [r.key, r.status])).toEqual([
      ['invite:i1', 'invited_email'],
      ['invite:i2', 'invited_sms'],
      ['referral:r1', 'joined'],
      ['referral:r2', 'qualified'],
    ]);
    expect(rows[0]).toMatchObject({ name: 'Sam', subtitle: 'sa•••@x.com' });
    expect(rows[1]).toMatchObject({ name: '•••• 0123', subtitle: null });
    expect(rows[2].subtitle).toBe('in Morning Movers');
  });

  it('handles missing arrays', () => {
    expect(mergeFriends(undefined, undefined)).toEqual([]);
  });

  it('nudge analytics by row type', () => {
    const rows = mergeFriends(invites, invitees);
    expect(nudgeAnalytics(rows[0])).toEqual({ target: 'invited', channel: 'email' });
    expect(nudgeAnalytics(rows[1])).toEqual({ target: 'invited', channel: 'sms' });
    expect(nudgeAnalytics(rows[2])).toEqual({ target: 'joined', channel: 'push' });
  });
});

describe('nudge view', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  it('shows a button, a wait label, or nothing', () => {
    expect(nudgeView({ available: true, nextAt: null, remaining: 2 }, now)).toEqual({ kind: 'button' });
    expect(nudgeView({ available: false, nextAt: '2026-10-18T10:00:00Z', remaining: 1 }, now)).toEqual({
      kind: 'wait',
      label: 'Nudged · again in 2d',
    });
    expect(nudgeView({ available: false, nextAt: '2026-10-16T15:30:00Z', remaining: 1 }, now)).toEqual({
      kind: 'wait',
      label: 'Nudged · again in 4h',
    });
    expect(nudgeView({ available: true, nextAt: null, remaining: 0 }, now)).toEqual({ kind: 'none' });
    expect(nudgeView({ available: false, nextAt: null, remaining: 2 }, now)).toEqual({ kind: 'none' });
    expect(nudgeView(null, now)).toEqual({ kind: 'none' });
  });

  it('untilLabel', () => {
    expect(untilLabel('2026-10-16T12:10:00Z', now)).toBe('10m');
    expect(untilLabel('2026-10-16T11:00:00Z', now)).toBe('now');
  });
});

describe('3-check-in progress (§10.1)', () => {
  it('formats progress and fractions, capping at required', async () => {
    const { progressLabel, progressFraction, checkInPhrase, myRewardLine, mergeFriends } = await import('../invite-form');
    expect(progressLabel({ days: 2, required: 3, deadline: 'x' })).toBe('2/3 check-ins');
    expect(progressLabel({ days: 5, required: 3, deadline: 'x' })).toBe('3/3 check-ins');
    expect(progressFraction({ days: 1, required: 4, deadline: 'x' })).toBe(0.25);
    expect(progressFraction({ days: 1, required: 0, deadline: 'x' })).toBe(0);
    expect(checkInPhrase(3)).toBe('check in on 3 different days');
    expect(checkInPhrase(5)).toBe('check in on 5 different days');
    expect(checkInPhrase(1)).toBe('check in once');
    expect(myRewardLine({ days: 2, required: 3, deadline: 'x' }, 'Maya', 7)).toBe(
      '1 more check-in unlocks a free week for you and Maya'
    );
    expect(myRewardLine({ days: 0, required: 3, deadline: 'x' }, '', 5)).toBe(
      '3 more check-ins unlock 5 free days for you and your friend'
    );

    const rows = mergeFriends(undefined, [
      { id: 'a', displayName: 'Sam', avatarUrl: null, status: 'pending', joinedAt: 'x', qualifiedAt: null, circleName: null, progress: { days: 2, required: 3, deadline: 'x' } },
      { id: 'b', displayName: 'Lee', avatarUrl: null, status: 'qualified', joinedAt: 'x', qualifiedAt: 'y', circleName: null, progress: { days: 3, required: 3, deadline: 'x' } },
      { id: 'c', displayName: 'Jo', avatarUrl: null, status: 'pending', joinedAt: 'x', qualifiedAt: null, circleName: null },
    ]);
    expect(rows.map((r) => r.progress)).toEqual([{ days: 2, required: 3, deadline: 'x' }, null, null]);
  });
});
