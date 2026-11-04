/**
 * Offline dry run of the Pro lifecycle prompts against a READ-ONLY prod
 * snapshot (JSON files from `supabase db query --read-only`): who is in which
 * state now, when their card shows, and when each push would go out in their
 * local time. Sends nothing, writes nothing.
 *
 *   npx tsx apps/web/scripts/pro-lifecycle-dry-run.ts <snapshot-dir> [nowIso]
 * Snapshot files: profiles.json grants.json events.json prefs.json tokens.json usage.json
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_CONFIG,
  computeLifecycleState,
  decideExpiredPush,
  decideExpiringPush,
  expiringPushAt,
  lifecycleCreative,
  localTimeLabel,
  purchaseHistory,
  renderPushCopy,
  type LifecycleFacts,
  type ProUsage,
} from '../app/lib/pro-lifecycle';
import { buildPromoProps, parseClientActions } from '../app/lib/promos';
import { isWithinQuietWindow } from '../app/lib/services/notification-orchestrator';

const dir = process.argv[2];
const NOW = process.argv[3] ? new Date(process.argv[3]) : new Date();
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as any[];
const iso = (v: string | null) => (v ? new Date(v.replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString() : null);

const profiles = read('profiles.json');
const grants = read('grants.json');
const events = read('events.json');
const prefs = read('prefs.json');
const tokens = read('tokens.json');
const usageRows = read('usage.json');
const config = DEFAULT_CONFIG;
const ACTIONS = parseClientActions('open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1');

function minutesIn(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return (g('hour') % 24) * 60 + g('minute');
}

for (const raw of profiles) {
  const profile = { ...raw, subscription_expires_at: iso(raw.subscription_expires_at), trial_started_at: iso(raw.trial_started_at), trial_ends_at: iso(raw.trial_ends_at), trial_converted_at: iso(raw.trial_converted_at) };
  const g = grants.filter((x) => x.user_id === raw.id).map((x) => ({ ...x, created_at: iso(x.created_at)!, expires_at: iso(x.expires_at), revoked_at: iso(x.revoked_at) }));
  const ev = events.filter((x) => x.user_id === raw.id).map((x) => ({ type: x.type, environment: x.environment, raw: { period_type: x.period_type } }));
  const facts: LifecycleFacts = { profile, grants: g, ...purchaseHistory(ev, profile) };
  const pref = prefs.find((x) => x.user_id === raw.id);
  const tz = profile.timezone || 'America/New_York';
  const qTz = pref?.quiet_hours_timezone || tz;
  const quiet = (at: Date) => !!pref?.quiet_hours_start && isWithinQuietWindow(minutesIn(at, qTz), pref.quiet_hours_start, pref.quiet_hours_end);
  const u = usageRows.find((x) => x.user_id === raw.id);
  const usage: ProUsage | null = u ? { aiMeals: Number(u.ai_meals), meals: Number(u.meals), fitzyChats: Number(u.fitzy_chats), plans: Number(u.plans) } : null;
  const platforms = [...new Set(tokens.filter((t) => t.user_id === raw.id).map((t) => t.platform))].join('+') || 'no push device';

  const nowResult = computeLifecycleState(facts, NOW, config);
  console.log(`\n=== ${raw.display_name} (${raw.id.slice(0, 8)}) · ${platforms} · tz ${tz}`);
  console.log(`  now (${NOW.toISOString()}): ${nowResult.state ?? `none (${nowResult.reason})`}${nowResult.endsAt ? ` · Pro ends ${localTimeLabel(new Date(nowResult.endsAt), tz)}` : ''} · trial available: ${nowResult.trialAvailable}`);
  if (nowResult.reason && ['internal_account', 'purchased', 'lifetime', 'store_subscription', 'no_grant', 'revoked'].includes(nowResult.reason)) continue;

  // Simulate the next 8 days hour by hour (cron :25 for pushes, downgrade at the :20 after expiry).
  let cardStart: Date | null = null;
  let expiringPush: Date | null = null;
  let expiredPush: Date | null = null;
  let expiredCardStart: Date | null = null;
  const end = nowResult.endsAt ? new Date(nowResult.endsAt) : null;
  for (let t = Math.ceil(NOW.getTime() / 300_000) * 300_000; t < NOW.getTime() + 8 * 86_400_000; t += 5 * 60_000) {
    const at = new Date(t);
    const downgraded = end && at.getTime() >= end.getTime() + (20 - (end.getUTCMinutes() % 60) + 60) % 60 * 60_000 + 1;
    const f2: LifecycleFacts = downgraded ? { ...facts, profile: { ...facts.profile, subscription_tier: 'free', subscription_status: 'cancelled' } } : facts;
    const r = computeLifecycleState(f2, at, config);
    if (r.state === 'pro_expiring' && !cardStart) cardStart = at;
    if (r.state === 'pro_expired' && !expiredCardStart) expiredCardStart = at;
    if (at.getUTCMinutes() === 25 && r.state === 'pro_expiring' && !expiringPush) {
      const d = decideExpiringPush({ now: at, endsAt: new Date(r.endsAt!), timezone: tz, inQuietHours: quiet(at) });
      if (d.send) expiringPush = at;
    }
    if (r.state === 'pro_expired' && !expiredPush && (at.getUTCMinutes() === 20 || at.getUTCMinutes() === 25)) {
      const d = decideExpiredPush({ now: at, endedAt: new Date(r.endsAt!), inQuietHours: quiet(at) });
      if (d.send) expiredPush = at;
    }
  }
  if (end) console.log(`  10:00-local rule target: ${localTimeLabel(expiringPushAt(end, tz), tz)}`);
  console.log(`  card "Pro ending" from: ${cardStart ? `${localTimeLabel(cardStart, tz)} (${cardStart.toISOString()})` : '—'}`);
  console.log(`  push pro_expiring_reminder: ${expiringPush ? `${localTimeLabel(expiringPush, tz)} (${expiringPush.toISOString()})` : '—'}`);
  console.log(`  card "Pro ended" from: ${expiredCardStart ? `${localTimeLabel(expiredCardStart, tz)} until +${config.states.pro_expired.daysAfter} days` : '—'}`);
  console.log(`  push pro_expired: ${expiredPush ? `${localTimeLabel(expiredPush, tz)} (${expiredPush.toISOString()})` : '—'}`);

  for (const [state, at] of [['pro_expiring', expiringPush ?? cardStart], ['pro_expired', expiredPush ?? expiredCardStart]] as const) {
    if (!at) continue;
    const f2 = state === 'pro_expired' ? { ...facts, profile: { ...facts.profile, subscription_tier: 'free' } } : facts;
    const r = computeLifecycleState(f2, at, config);
    if (r.state !== state) continue;
    const built = lifecycleCreative(state, config, { result: r, usage, firstName: raw.display_name, timezone: tz }, at);
    if ('error' in built) {
      console.log(`  ${state} card error: ${built.error}`);
      continue;
    }
    const props = buildPromoProps(state, built.creative, ACTIONS);
    console.log(`  ${state} card: [${props?.layout}] "${props?.title}" — ${props?.body} [${props?.primary.label} → paywall ${JSON.stringify(props?.primary.action.params)}]${props?.countdown ? ` countdown ${props.countdown.label} → ${props.countdown.endsAt}` : ''}`);
    const push = renderPushCopy(config.states[state].push, { state, now: at, timezone: tz, endsAt: new Date(r.endsAt!), source: r.source, periodDays: r.periodDays, trialAvailable: r.trialAvailable, usage, firstName: raw.display_name });
    console.log(`  ${state} push: ${'error' in push ? push.error : `"${push.title}" / "${push.body}"`}`);
  }
}
