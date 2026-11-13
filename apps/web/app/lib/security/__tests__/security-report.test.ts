import * as Sentry from '@sentry/nextjs';
import { describe, expect, it, vi } from 'vitest';

import { ALERT_COOLDOWN_MS, cooldownFor, renderAlertEmail, reportAlertToSentry, signalsToSend } from '../alerts';
import { attackLevel, evaluateSignals, failedLoginsByAccount, hourlySeries, integrityHealth, isTokenlessReason, tiles, topOffenders, type EventRow, type Signal } from '../security-report';

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

  it('fail-open: device-environment fail-opens (device_error:<code>) never fire the infra signal', () => {
    const device = many(80, { result: 'fail_open', reason: 'device_error:prepare_-14' });
    expect(run(device, { quarter: device })).toEqual([]);
    const s = run([], { quarter: [...device, row({ result: 'fail_open', reason: 'decode HTTP 503' })] });
    expect(s).toEqual([expect.objectContaining({ signal: 'fail_open', value: 1, level: 'elevated' })]);
  });

  it('device-environment fail-opens are attempts, not blocks (block rate unaffected)', () => {
    expect(run([...many(10, {}), ...many(30, { result: 'fail_open', reason: 'device_error:prepare_-9' })])).toEqual([]);
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

describe('fail-open split (infrastructure vs device environment)', () => {
  it('tiles count them separately; failOpens is infrastructure only', () => {
    const t = tiles([
      row({ result: 'fail_open', reason: 'verifier not configured' }),
      row({ result: 'fail_open', reason: null }),
      row({ result: 'fail_open', reason: 'device_error:prepare_-14', count: 3 }),
      row({ result: 'fail_open', reason: 'device_error:token_timeout' }),
      row({ result: 'pass' }),
    ]);
    expect(t).toMatchObject({ failOpens: 2, deviceErrorFailOpens: 4, integrityAttempts: 7, integrityPasses: 1, integrityBlocks: 0 });
  });
});

describe('integrity_broken (verification not working for an action, last 24 h)', () => {
  const day = (rows: EventRow[]) => evaluateSignals({ hour: [], quarter: [], day: rows }).filter((x) => x.signal === 'integrity_broken');

  it('the 2026-11-11 incident shape fires: auth actions all fail_open "unusable", 0 passes', () => {
    const rows = [
      ...many(25, { action: 'google', result: 'fail_open', reason: 'unusable' }),
      ...many(3, { action: 'google', result: 'fail_open', reason: 'device_error:prepare_-14' }),
      ...many(6, { action: 'login', result: 'fail_open', reason: 'unusable' }),
      ...many(4, { action: 'register', result: 'fail_open', reason: 'unusable' }),
      ...many(15, { action: 'food_ai', result: 'pass' }),
    ];
    const [sig] = day(rows);
    expect(sig).toMatchObject({ signal: 'integrity_broken', level: 'elevated', value: 3 });
    expect(sig.detail).toContain('google: 25 attempts with a token, 0 passes; 89% infra fail-open (25/28, mostly "unusable")');
    expect(sig.detail).toContain('login: 6 attempts with a token, 0 passes');
    expect(sig.detail).not.toContain('food_ai');
  });

  it('our programming errors (503 blocks) fire it too: they are token attempts with no pass', () => {
    expect(day(many(3, { action: 'login', result: 'block', reason: 'integrity_internal_error:body_consumed' }))).toHaveLength(1);
    expect(day(many(3, { action: 'login', result: 'bypass', reason: 'reviewer:integrity_internal_error:body_consumed' }))).toHaveLength(1);
  });

  it('a healthy action with some passes is fine; fewer than 3 token attempts is not enough', () => {
    expect(day([...many(1, { action: 'login', result: 'pass' }), ...many(5, { action: 'login', result: 'block', reason: 'device_integrity' })])).toEqual([]);
    expect(day(many(2, { action: 'login', result: 'block', reason: 'cert_mismatch' }))).toEqual([]);
  });

  it('phones without a token (missing_token, device errors) never mean OUR verification is broken', () => {
    expect(
      day([
        ...many(10, { action: 'login', result: 'block', reason: 'missing_token' }),
        ...many(10, { action: 'login', result: 'bypass', reason: 'reviewer:missing_token' }),
        ...many(10, { action: 'google', result: 'fail_open', reason: 'device_error:prepare_-9' }),
      ])
    ).toEqual([]);
    expect(isTokenlessReason('bypass:reviewer:missing_token')).toBe(true);
    expect(isTokenlessReason('unusable')).toBe(false);
  });

  it('infra fail-open ≥ 50 % of attempts fires even with passes', () => {
    const h = integrityHealth([...many(2, { action: 'refresh', result: 'pass' }), ...many(2, { action: 'refresh', result: 'fail_open', reason: 'decode HTTP 503' })]);
    expect(h[0]).toMatchObject({ action: 'refresh', passes: 2, infraFailOpens: 2, failOpenShare: 0.5, broken: true, topFailOpenReason: 'decode HTTP 503' });
    expect(integrityHealth([...many(3, { action: 'refresh', result: 'pass' }), ...many(2, { action: 'refresh', result: 'fail_open', reason: 'decode HTTP 503' })])[0].broken).toBe(false);
  });

  it('emails at most once per 6 h; Sentry level error; explicit subject', () => {
    const sig: Signal = { signal: 'integrity_broken', level: 'elevated', value: 1, threshold: 0, detail: 'login: 6 attempts with a token, 0 passes' };
    expect(cooldownFor('integrity_broken')).toBe(6 * 60 * 60_000);
    const at = (ms: number) => [{ signal: 'integrity_broken', last_sent_at: new Date(NOW.getTime() - ms).toISOString(), last_severity: 'elevated' }];
    expect(signalsToSend([sig], at(5 * 60 * 60_000), NOW)).toEqual([]);
    expect(signalsToSend([sig], at(6 * 60 * 60_000), NOW)).toHaveLength(1);
    reportAlertToSentry(sig);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('security_alert: integrity_broken', expect.objectContaining({ level: 'error' }));
    const m = renderAlertEmail([sig], 'elevated', NOW);
    expect(m.subject).toBe('[FitCircle security] ACTION NEEDED: app integrity verification is broken (integrity_broken)');
    expect(m.text).toContain('NOT being verified');
    expect(m.html).toContain('NOT being verified');
  });
});
