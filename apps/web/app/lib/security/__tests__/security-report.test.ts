import * as Sentry from '@sentry/nextjs';
import { describe, expect, it, vi } from 'vitest';

import { ALERT_COOLDOWN_MS, renderAlertEmail, reportAlertToSentry, signalsToSend } from '../alerts';
import { attackLevel, evaluateSignals, failedLoginsByAccount, hourlySeries, tiles, topOffenders, type EventRow, type Signal } from '../security-report';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

const NOW = new Date('2026-11-07T12:00:00Z');
let seq = 0;
function row(p: Partial<EventRow>): EventRow {
  return {
    created_at: new Date(NOW.getTime() - 5 * 60_000 - seq++).toISOString(),
    kind: 'integrity',
    result: 'pass',
    reason: null,
    action: null,
    route: null,
    platform: 'android',
    app_version: null,
    user_id: null,
    device_id: null,
    account_hash: null,
    ip_prefix: null,
    asn: null,
    country: null,
    integrity_error: null,
    count: 1,
    ...p,
  };
}
const many = (k: number, p: Partial<EventRow>) => Array.from({ length: k }, () => row(p));
const run = (hour: EventRow[], extra: { quarter?: EventRow[]; day?: EventRow[] } = {}) =>
  evaluateSignals({ hour, quarter: extra.quarter ?? hour, day: extra.day ?? hour });

describe('alert thresholds', () => {
  it('quiet traffic is normal', () => {
    const s = run([...many(30, {}), ...many(2, { kind: 'login_failure', result: 'rejected', account_hash: 'a' })]);
    expect(s).toEqual([]);
    expect(attackLevel(s)).toBe('normal');
  });

  it('failed logins: > 50/h total, > 10 for one account, > 20 from one prefix', () => {
    expect(run(many(51, { kind: 'login_failure', result: 'rejected' }))[0]).toMatchObject({ signal: 'failed_logins', value: 51, threshold: 50, level: 'elevated' });
    expect(run(many(50, { kind: 'login_failure', result: 'rejected' }))).toEqual([]);
    expect(run(many(11, { kind: 'login_failure', result: 'rejected', account_hash: 'abcdef0123456789' }))[0]).toMatchObject({ signal: 'failed_logins', value: 11, threshold: 10, detail: 'account abcdef012345' });
    expect(run(many(21, { kind: 'login_failure', result: 'rejected', ip_prefix: '203.0.113.0/24' }))[0]).toMatchObject({ value: 21, threshold: 20, detail: '203.0.113.0/24' });
  });

  it('sign-ups from one ASN or prefix: > 5/h', () => {
    expect(run(many(6, { kind: 'signup', asn: '212238' }))[0]).toMatchObject({ signal: 'signup_concentration', value: 6, detail: 'AS 212238' });
    expect(run(many(5, { kind: 'signup', asn: '212238' }))).toEqual([]);
  });

  it('integrity block rate: > 10 % with at least 20 attempts', () => {
    expect(run([...many(17, {}), ...many(3, { result: 'block' })])[0]).toMatchObject({ signal: 'integrity_block_rate', value: 0.15, level: 'elevated' });
    expect(run([...many(5, {}), ...many(5, { result: 'block' })])).toEqual([]); // < 20 attempts
    expect(run([...many(10, {}), ...many(10, { result: 'block' })])[0]).toMatchObject({ level: 'under_attack' });
    // attested passes are not attempts
    expect(run([...many(100, { result: 'attested' }), ...many(5, {}), ...many(15, { result: 'block' })])[0]).toMatchObject({ value: 0.75 });
  });

  it('fail-open: any in the last 15 minutes', () => {
    const s = run([], { quarter: [row({ result: 'fail_open' })] });
    expect(s).toEqual([expect.objectContaining({ signal: 'fail_open', value: 1, level: 'elevated' })]);
  });

  it('rate-limit hits: > 500/h, counting deduplicated rows by count', () => {
    expect(run([row({ kind: 'rate_limit', result: 'limited', count: 400 }), row({ kind: 'rate_limit', result: 'limited', count: 101 })])[0]).toMatchObject({ signal: 'rate_limit_hits', value: 501 });
    expect(run([row({ kind: 'rate_limit', result: 'limited', count: 1600 })])[0]).toMatchObject({ level: 'under_attack' });
  });

  it('referral rejections: > 5/day (held-for-review rows do not count)', () => {
    const day = [...many(6, { kind: 'referral_rejection', result: 'rejected' }), ...many(10, { kind: 'referral_rejection', result: 'log_only' })];
    expect(run([], { day })[0]).toMatchObject({ signal: 'referral_rejections', value: 6 });
  });

  it('level is under_attack when any signal is', () => {
    const s = run([...many(160, { kind: 'login_failure', result: 'rejected' }), ...many(6, { kind: 'signup', ip_prefix: 'p' })]);
    expect(s.map((x) => x.level).sort()).toEqual(['elevated', 'under_attack']);
    expect(attackLevel(s)).toBe('under_attack');
  });
});

describe('cooldown', () => {
  const sig = (level: Signal['level']): Signal => ({ signal: 'failed_logins', level, value: 60, threshold: 50 });
  it('one alert per signal per 2 h; an escalation to under_attack re-alerts', () => {
    const recent = [{ signal: 'failed_logins', last_sent_at: new Date(NOW.getTime() - 30 * 60_000).toISOString(), last_severity: 'elevated' }];
    expect(signalsToSend([sig('elevated')], recent, NOW)).toEqual([]);
    expect(signalsToSend([sig('under_attack')], recent, NOW)).toHaveLength(1);
    const old = [{ ...recent[0], last_sent_at: new Date(NOW.getTime() - ALERT_COOLDOWN_MS).toISOString() }];
    expect(signalsToSend([sig('elevated')], old, NOW)).toHaveLength(1);
    expect(signalsToSend([sig('elevated')], [], NOW)).toHaveLength(1);
  });

  it('Sentry message is monitor-friendly', () => {
    reportAlertToSentry({ signal: 'fail_open', level: 'under_attack', value: 60, threshold: 0 });
    expect(Sentry.captureMessage).toHaveBeenCalledWith('security_alert: fail_open', expect.objectContaining({ level: 'warning', tags: { security_alert: 'fail_open', severity: 'attack' }, fingerprint: ['security_alert', 'fail_open'] }));
  });

  it('email lists every signal with its threshold', () => {
    const m = renderAlertEmail([{ signal: 'integrity_block_rate', level: 'elevated', value: 0.15, threshold: 0.1, detail: '20 attempts', baseline: 0.01 }], 'elevated', NOW);
    expect(m.subject).toBe('[FitCircle security] Elevated: integrity_block_rate');
    expect(m.text).toContain('15% (threshold 10%');
  });
});

describe('report aggregation', () => {
  const rows = [
    row({ kind: 'integrity', result: 'pass' }),
    row({ kind: 'integrity', result: 'block', asn: '1', ip_prefix: 'a', device_id: 'd1' }),
    row({ kind: 'rate_limit', result: 'limited', asn: '1', count: 7 }),
    row({ kind: 'login_failure', result: 'rejected', account_hash: 'h1', ip_prefix: 'a' }),
    row({ kind: 'login_failure', result: 'rejected', account_hash: 'h1', ip_prefix: 'b' }),
    row({ kind: 'free_ai_device_limit', result: 'block' }),
  ];

  it('tiles', () => {
    expect(tiles(rows)).toMatchObject({ integrityAttempts: 2, integrityPasses: 1, integrityPassRate: 0.5, integrityBlocks: 1, rateLimitHits: 7, failedLogins: 2, freeAiDeviceLimitHits: 1 });
    expect(tiles([]).integrityPassRate).toBeNull();
  });

  it('offenders count adverse rows only', () => {
    expect(topOffenders(rows, 'asn')).toEqual([expect.objectContaining({ key: '1', count: 8, kinds: { integrity: 1, rate_limit: 7 } })]);
    expect(topOffenders([row({ asn: '9' })], 'asn')).toEqual([]);
  });

  it('failed logins per account hash', () => {
    expect(failedLoginsByAccount(rows)).toEqual([expect.objectContaining({ accountHash: 'h1', count: 2, distinctIpPrefixes: 2 })]);
  });

  it('hourly series per kind', () => {
    const pts = hourlySeries(rows);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ hour: '2026-11-07T11:00:00.000Z', counts: { integrity: 2, rate_limit: 7, login_failure: 2, free_ai_device_limit: 1 } });
  });
});
