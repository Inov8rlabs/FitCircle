/**
 * Security alert cron (every 15 min, /api/cron/security/alerts; docs/SECURITY_TELEMETRY.md).
 *
 *   1. evaluate the signals (last 15 min / 1 h / 24 h vs thresholds; 7-day baselines as context)
 *   2. for each firing signal not alerted in the last 2 h (security_alert_state), or escalated
 *      from elevated to under_attack: email the owner (SECURITY_ALERT_RECIPIENTS, else
 *      ADS_REPORT_RECIPIENTS) and send a Sentry message `security_alert: <signal>`
 *      (tags security_alert=<signal>, severity=elevated|attack)
 *   3. on the run in the first quarter of each hour: the `Security Summary` Amplitude event
 */
import * as Sentry from '@sentry/nextjs';

import { reportRecipients } from '@/lib/ads/services/email-report-service';
import { sendEvents } from '@/lib/analytics/amplitude-server';
import { AnalyticsEvents } from '@/lib/analytics/events.generated';
import { esc } from '@/lib/email/brand-shell';
import { sendEmail } from '@/lib/email/email-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { currentSignals, tiles, type AttackLevel, type Signal, type SignalId } from './security-report';

export const ALERT_COOLDOWN_MS = 2 * 60 * 60_000;
/** Sentry Cron Monitor slug around the alert cron. */
export const SECURITY_ALERT_MONITOR_SLUG = 'security-alert-cron';
export const ADMIN_SECURITY_URL = 'https://admintools.inov8rlabs.com/apps/fitcircle/security';

export interface AlertState {
  signal: string;
  last_sent_at: string;
  last_severity: string;
}

/** Pure: firing signals out of cooldown (an escalation elevated → under_attack re-alerts). */
export function signalsToSend(signals: Signal[], state: AlertState[], now: Date): Signal[] {
  const bySignal = new Map(state.map((s) => [s.signal, s]));
  return signals.filter((s) => {
    const prev = bySignal.get(s.signal);
    if (!prev) return true;
    const age = now.getTime() - Date.parse(prev.last_sent_at);
    if (!(age < ALERT_COOLDOWN_MS)) return true;
    return prev.last_severity === 'elevated' && s.level === 'under_attack';
  });
}

export function alertRecipients(env: Record<string, string | undefined> = process.env): string[] {
  const list = (env.SECURITY_ALERT_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return list.length ? list : reportRecipients(env);
}

/** Sentry `severity` tag for a signal level. */
export const severityTag = (s: Signal) => (s.level === 'under_attack' ? 'attack' : 'elevated');

const pct = (s: Signal, v: number) => (s.signal === 'integrity_block_rate' ? `${Math.round(v * 100)}%` : String(v));

export function renderAlertEmail(signals: Signal[], level: AttackLevel, now: Date): { subject: string; html: string; text: string } {
  const label = level === 'under_attack' ? 'Under attack' : level === 'elevated' ? 'Elevated' : 'Normal';
  const subject = `[FitCircle security] ${label}: ${signals.map((s) => s.signal).join(', ')}`;
  const lines = signals.map(
    (s) =>
      `- ${s.signal}: ${pct(s, s.value)} (threshold ${pct(s, s.threshold)}, ${s.level}${s.detail ? `, ${s.detail}` : ''}` +
      `${s.baseline != null ? `, 7-day baseline ${s.baseline.toFixed(2)}` : ''})`
  );
  const text = `Security status: ${label} (${now.toISOString()})\n\n${lines.join('\n')}\n\nSecurity page: ${ADMIN_SECURITY_URL}\nKill switch: remote config integrity_enforce_android (block | log | off).\n`;
  const rows = signals
    .map(
      (s) =>
        `<tr><td style="padding:4px 8px;">${esc(s.signal)}</td><td style="padding:4px 8px;"><b>${esc(pct(s, s.value))}</b></td>` +
        `<td style="padding:4px 8px;">${esc(pct(s, s.threshold))}</td><td style="padding:4px 8px;">${esc(s.level)}</td>` +
        `<td style="padding:4px 8px;">${esc(s.detail ?? '')}</td><td style="padding:4px 8px;">${s.baseline != null ? esc(s.baseline.toFixed(2)) : ''}</td></tr>`
    )
    .join('');
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<h2>Security status: ${esc(label)}</h2><p>${esc(now.toISOString())}</p>
<table border="1" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
<tr><th>Signal</th><th>Value</th><th>Threshold</th><th>Level</th><th>Detail</th><th>7-day baseline</th></tr>${rows}</table>
<p><a href="${esc(ADMIN_SECURITY_URL)}">Open the Security page</a>. Kill switch: remote config <code>integrity_enforce_android</code> (block | log | off).</p>
</body></html>`;
  return { subject, html, text };
}

/** Sentry message per alert (stable message, tags and fingerprint for monitors). Never throws. */
export function reportAlertToSentry(s: Signal): void {
  try {
    Sentry.captureMessage(`security_alert: ${s.signal}`, {
      level: 'warning',
      tags: { security_alert: s.signal, severity: severityTag(s) },
      fingerprint: ['security_alert', s.signal],
      extra: { value: s.value, threshold: s.threshold, baseline: s.baseline ?? null, detail: s.detail ?? null },
    });
  } catch {
    // best-effort
  }
}

async function loadState(): Promise<AlertState[]> {
  const { data, error } = await createAdminSupabase().from('security_alert_state').select('signal, last_sent_at, last_severity');
  if (error) {
    console.warn('[security-alerts] state read failed:', error.message);
    return [];
  }
  return (data ?? []) as AlertState[];
}

async function saveState(signals: Signal[], now: Date): Promise<void> {
  if (!signals.length) return;
  const rows = signals.map((s) => ({ signal: s.signal, last_sent_at: now.toISOString(), last_severity: s.level === 'under_attack' ? 'under_attack' : 'elevated', last_value: s.value, updated_at: now.toISOString() }));
  const { error } = await createAdminSupabase().from('security_alert_state').upsert(rows, { onConflict: 'signal' });
  if (error) console.warn('[security-alerts] state write failed:', error.message);
}

export interface AlertRunResult {
  level: AttackLevel;
  firing: SignalId[];
  sent: SignalId[];
  emailed: boolean;
  summarySent: boolean;
  truncated: boolean;
}

export async function runSecurityAlerts(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<AlertRunResult> {
  const { signals, level, hourRows, truncated } = await currentSignals(now);
  const toSend = signalsToSend(signals, await loadState(), now);
  let emailed = false;
  if (toSend.length && !opts.dryRun) {
    for (const s of toSend) reportAlertToSentry(s);
    const mail = renderAlertEmail(toSend, level, now);
    const res = await sendEmail({ to: alertRecipients(), subject: mail.subject, html: mail.html, text: mail.text, category: 'security_alert' });
    emailed = res.success;
    if (!res.success) console.error('[security-alerts] email failed:', res.errorName ?? res.error);
    await saveState(toSend, now);
  }

  let summarySent = false;
  if (now.getUTCMinutes() < 15 && !opts.dryRun) {
    const t = tiles(hourRows);
    const bucket = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
    const e = AnalyticsEvents.securitySummary({
      window_minutes: 60,
      attack_status: level,
      integrity_pass: t.integrityPasses,
      integrity_block: t.integrityBlocks,
      integrity_fail_open: t.failOpens,
      rate_limit_hits: t.rateLimitHits,
      login_failures: t.failedLogins,
      signups: t.signups,
      signup_blocks: t.signupBlocks,
      referral_rejections: t.referralRejections,
      ai_device_limit_hits: t.freeAiDeviceLimitHits,
      nonce_replays: t.nonceReplays,
    });
    summarySent = await sendEvents([{ event_type: e.name, event_properties: { ...e.properties }, insert_id: `security-summary:${bucket}`, time: now.getTime() }]);
  }

  return { level, firing: signals.map((s) => s.signal), sent: toSend.map((s) => s.signal), emailed, summarySent, truncated };
}
