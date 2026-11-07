/**
 * Admin Tools "Security" page reads (docs/SECURITY_TELEMETRY.md, "Admin API").
 * Read-only; every response is built from security_events + remote config.
 */
import { RemoteConfigService } from '@/lib/remote-config/service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { OFFENDER_COLUMNS, currentSignals, failedLoginsByAccount, hourlySeries, loadEvents, tiles, topOffenders, type EventRow } from './security-report';

const HOUR = 3_600_000;
const WINDOWS = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR } as const;
export type WindowKey = keyof typeof WINDOWS;

export class SecurityAdminError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function parseWindow(raw: string | null): WindowKey {
  if (raw === null || raw === '') return '24h';
  if (raw === '24h' || raw === '7d') return raw;
  throw new SecurityAdminError(400, 'VALIDATION_ERROR', 'window must be 24h or 7d');
}

export function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const v = raw === null || raw === '' ? def : Number(raw);
  if (!Number.isInteger(v)) throw new SecurityAdminError(400, 'VALIDATION_ERROR', 'expected an integer');
  return Math.min(max, Math.max(min, v));
}

const PLACEHOLDER_USER = '00000000-0000-0000-0000-000000000000';
const EVENT_COLUMNS = 'id, created_at, kind, result, reason, action, route, platform, app_version, user_id, device_id, ip_prefix, asn, country, integrity_error, count';

/** API shape of one event (camelCase; no account hash, no verdict blob). */
export function toApiEvent(r: EventRow & { id?: string }) {
  return {
    id: r.id ?? '',
    createdAt: r.created_at,
    kind: r.kind,
    route: r.route,
    platform: r.platform,
    appVersion: r.app_version,
    result: r.result,
    reason: r.reason,
    integrityError: r.integrity_error,
    deviceId: r.device_id,
    userId: r.user_id,
    ipPrefix: r.ip_prefix,
    asn: r.asn,
    country: r.country,
    count: r.count || 1,
  };
}

export class SecurityAdminService {
  static async summary(now = new Date()) {
    const week = await loadEvents(new Date(now.getTime() - WINDOWS['7d']), now);
    const dayRows = week.rows.filter((r) => Date.parse(r.created_at) >= now.getTime() - WINDOWS['24h']);
    const [{ signals, level }, enforcement] = await Promise.all([currentSignals(now), this.enforcement()]);
    const tile = (rows: EventRow[]) => {
      const { signups: _s, nonceReplays: _n, ...t } = tiles(rows);
      return t;
    };
    return {
      generatedAt: now.toISOString(),
      windows: { '24h': tile(dayRows), '7d': tile(week.rows) },
      status: {
        level,
        signals: signals.map((s) => ({ signal: s.signal, level: s.level, value: s.value, threshold: s.threshold, detail: s.detail ?? null })),
        evaluatedAt: now.toISOString(),
      },
      enforcement,
      truncated: week.truncated,
    };
  }

  /** integrity_enforce_android as resolved now, plus who set the admin default. */
  static async enforcement() {
    const r = await RemoteConfigService.resolveConfig('integrity_enforce_android', { userId: PLACEHOLDER_USER, platform: 'android' });
    let updatedAt: string | null = null;
    let updatedBy: string | null = null;
    if (r.source === 'default') {
      const { data } = await createAdminSupabase()
        .from('remote_config_defaults')
        .select('updated_at, updated_by')
        .eq('config_key', 'integrity_enforce_android')
        .maybeSingle();
      updatedAt = (data as any)?.updated_at ?? null;
      updatedBy = (data as any)?.updated_by ?? null;
    }
    const value = r.value === 'block' || r.value === 'log' || r.value === 'off' ? r.value : null;
    return {
      integrityEnforceAndroid: value,
      source: r.source === 'code' ? ('code' as const) : ('admin' as const),
      updatedAt,
      updatedBy,
      ...(r.ruleName ? { ruleName: r.ruleName } : {}),
    };
  }

  static async timeseries(q: URLSearchParams, now = new Date()) {
    const days = clampInt(q.get('days'), 7, 1, 7);
    const start = new Date(Math.floor((now.getTime() - days * 24 * HOUR) / HOUR) * HOUR);
    const { rows, truncated } = await loadEvents(start, now);
    return { start: start.toISOString(), end: now.toISOString(), bucket: 'hour' as const, points: hourlySeries(rows), truncated };
  }

  static async offenders(q: URLSearchParams, now = new Date()) {
    const window = parseWindow(q.get('window'));
    const limit = clampInt(q.get('limit'), 10, 1, 100);
    const { rows, truncated } = await loadEvents(new Date(now.getTime() - WINDOWS[window]), now);
    return {
      window,
      asn: topOffenders(rows, OFFENDER_COLUMNS.asn, limit).map((o) => ({ ...o, label: `AS ${o.key}` })),
      ipPrefix: topOffenders(rows, OFFENDER_COLUMNS.ipPrefix, limit),
      country: topOffenders(rows, OFFENDER_COLUMNS.country, limit),
      deviceId: topOffenders(rows, OFFENDER_COLUMNS.deviceId, limit),
      truncated,
    };
  }

  static async failedLogins(q: URLSearchParams, now = new Date()) {
    const window = parseWindow(q.get('window'));
    const limit = clampInt(q.get('limit'), 20, 1, 200);
    const { rows, truncated } = await loadEvents(new Date(now.getTime() - WINDOWS[window]), now, { kind: 'login_failure' });
    return { window, rows: failedLoginsByAccount(rows, limit), truncated };
  }

  static async events(q: URLSearchParams) {
    const limit = clampInt(q.get('limit'), 50, 1, 200);
    const before = q.get('before');
    if (before && Number.isNaN(Date.parse(before))) throw new SecurityAdminError(400, 'VALIDATION_ERROR', 'before must be an ISO timestamp');
    let query = createAdminSupabase().from('security_events').select(EVENT_COLUMNS);
    for (const key of ['kind', 'result', 'platform'] as const) {
      const v = q.get(key);
      if (v) query = query.eq(key, v);
    }
    if (before) query = query.lt('created_at', new Date(before).toISOString());
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit + 1);
    if (error) throw new Error(`security_events: ${error.message}`);
    const rows = (data ?? []) as Array<EventRow & { id: string }>;
    const page = rows.slice(0, limit);
    return { events: page.map(toApiEvent), nextBefore: rows.length > limit ? page[page.length - 1].created_at : null };
  }
}
