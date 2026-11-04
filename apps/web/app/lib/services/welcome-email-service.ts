/**
 * Welcome email on every first-time account creation (docs/EMAIL_QUALITY.md §B).
 *
 * Call sites (only where an account was just CREATED, never on a returning
 * sign-in):
 *   - POST /api/auth/register            (web, server-side sign-up)
 *   - POST /api/auth/welcome             (web client sign-up via supabase.auth.signUp;
 *                                         the server re-checks the account is < 1 h old)
 *   - POST /api/mobile/auth/register     (iOS / Android email sign-up)
 *   - POST /api/mobile/auth/apple|google (only when findOrCreateSocialUser says isNewUser)
 *
 * Exactly once per user, across platforms: the send is claimed in
 * `profiles.metadata.welcome_email` with a conditional update
 * (`… where metadata->welcome_email is null`) BEFORE Resend is called, so a
 * retried request, a double tap, or "signed up on web, then signed in with
 * Google on the phone" can never send a second one. Resend's idempotency key
 * `welcome/<user id>` is a second guard. No migration: profiles.metadata is the
 * server-owned jsonb other lifecycle jobs use (test_device, onboarding_nudges).
 *
 *   metadata.welcome_email = {
 *     status: 'sending' | 'sent' | 'failed' | 'skipped' | 'suppressed',
 *     claimed_at, sent_at?, provider_id?, reason?, method, platform, template
 *   }
 *
 * Never sent to: Play pre-launch / Firebase Test Lab robots (X-Test-Device
 * header or metadata.test_device), the App Review demo account, QA domains
 * (example.com, test.com), Google's generated Play tester accounts — the same
 * classifier the ads console and onboarding nudges use (lib/ads/test-users.ts).
 * Internal team addresses DO get it (that's how we QA it).
 *
 * Transactional: sent even if marketing email is off (a brand-new account
 * can't have opted out yet), but never to a suppressed (bounced / complained)
 * address — the central sender enforces that.
 *
 * Runs after the response (`runAfterResponse`); never throws, never fails a
 * sign-up. Kill switch: WELCOME_EMAIL_ENABLED=false.
 */
import { classifyTestUser, type TestUserReason } from '../ads/test-users';
import { campaignUnsubscribeUrl } from '../campaigns/unsubscribe';
import { sendEmail, type SendEmailParams, type SendEmailResult } from '../email/email-service';
import { WELCOME_TEMPLATE, welcomeEmail, type WelcomePlatform } from '../email/welcome-email';
import { createAdminSupabase } from '../supabase-admin';
import { runAfterResponse } from '../utils/after-response';

export type SignupMethod = 'email' | 'apple' | 'google';

export interface NewAccount {
  userId: string;
  email: string | null | undefined;
  displayName?: string | null;
  method: SignupMethod;
  platform?: WelcomePlatform;
  /** The sign-up request carried `X-Test-Device: 1` (Firebase Test Lab / Play pre-launch robots). */
  testDevice?: boolean;
}

export type WelcomeOutcome =
  | 'sent'
  | 'disabled'
  | 'no_email'
  | 'already_sent'
  | 'test_account'
  | 'suppressed'
  | 'failed';

export const WELCOME_METADATA_KEY = 'welcome_email';

export interface WelcomeRecord {
  status: 'sending' | 'sent' | 'failed' | 'skipped' | 'suppressed';
  claimed_at: string;
  sent_at?: string;
  provider_id?: string;
  reason?: string;
  method: SignupMethod;
  platform: WelcomePlatform;
  template: string;
}

export interface WelcomeProfile {
  email: string | null;
  isAdmin: boolean;
  metadata: Record<string, any> | null;
}

/** Storage seam: profiles.metadata in production, in-memory in tests. */
export interface WelcomeLedger {
  /** null when the profile row doesn't exist. */
  load(userId: string): Promise<WelcomeProfile | null>;
  /** Atomically set metadata.welcome_email when it's absent. False when someone else got there first. */
  claim(userId: string, record: WelcomeRecord): Promise<boolean>;
  /** Overwrite metadata.welcome_email (after a claim). */
  finish(userId: string, record: WelcomeRecord): Promise<void>;
}

export interface WelcomeDeps {
  ledger: WelcomeLedger;
  send: (p: SendEmailParams) => Promise<SendEmailResult>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

export function welcomeEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.WELCOME_EMAIL_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

/** Test-classifier reasons that skip the welcome email. `internal` (team) still gets it. */
const SKIP_REASONS: ReadonlySet<TestUserReason> = new Set(['review', 'test_lab', 'qa', 'play_testers', 'mock_attribution']);

export function welcomeSkipReason(
  account: Pick<NewAccount, 'email' | 'testDevice'>,
  profile: WelcomeProfile | null,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (account.testDevice || profile?.metadata?.test_device) return 'test:test_device';
  const reason = classifyTestUser({ email: account.email, isAdmin: profile?.isAdmin ?? false }, env);
  return reason && SKIP_REASONS.has(reason) ? `test:${reason}` : null;
}

/** Resend errors worth one retry (rate limit, outage, network). */
const TRANSIENT = new Set(['rate_limit_exceeded', 'application_error', 'internal_server_error', 'concurrent_idempotent_requests', 'network_error']);
export const WELCOME_RETRY_DELAY_MS = 2_000;

export function firstNameOf(displayName: string | null | undefined): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  // Usernames-as-names ("maya_r42") read badly in a greeting; keep real-looking first names only.
  return /^[\p{L}][\p{L}'-]{0,39}$/u.test(first) ? first : null;
}

function log(outcome: WelcomeOutcome, account: NewAccount, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ outcome, user: account.userId.slice(0, 8), method: account.method, platform: account.platform ?? null, ...extra });
  if (outcome === 'failed') console.error('[welcome-email]', line);
  else console.log('[welcome-email]', line);
}

/** Send the welcome email if this account hasn't had one. Never throws. */
export async function sendWelcomeOnce(account: NewAccount, deps: WelcomeDeps): Promise<WelcomeOutcome> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  try {
    if (!welcomeEmailEnabled(env)) return done('disabled');
    const email = (account.email ?? '').trim();
    if (!email.includes('@')) return done('no_email');

    const profile = await deps.ledger.load(account.userId);
    if (profile?.metadata?.[WELCOME_METADATA_KEY]) return done('already_sent');

    const base: WelcomeRecord = {
      status: 'sending',
      claimed_at: now().toISOString(),
      method: account.method,
      platform: account.platform ?? null,
      template: WELCOME_TEMPLATE,
    };

    const skip = welcomeSkipReason(account, profile, env);
    if (skip) {
      if (profile) await deps.ledger.claim(account.userId, { ...base, status: 'skipped', reason: skip });
      return done('test_account', { reason: skip });
    }

    if (profile) {
      if (!(await deps.ledger.claim(account.userId, base))) return done('already_sent');
    } else {
      // No profile row (bootstrap failed / not yet visible): we can't record the send.
      // Still send — the call sites only run on creation, and Resend's 24 h
      // idempotency key stops a duplicate from a retried request.
      console.warn('[welcome-email] profile row missing, sending without the once-only record:', account.userId);
    }

    const unsubscribe = campaignUnsubscribeUrl(account.userId);
    const rendered = welcomeEmail({
      firstName: firstNameOf(account.displayName),
      platform: account.platform ?? null,
      unsubscribeUrl: unsubscribe,
      postalAddress: env.EMAIL_POSTAL_ADDRESS || null,
    });
    const params: SendEmailParams = {
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      category: 'welcome',
      tags: { template: WELCOME_TEMPLATE, method: account.method, platform: account.platform ?? 'unknown' },
      headers: {
        'List-Unsubscribe': `<${unsubscribe}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      idempotencyKey: `welcome/${account.userId}`,
    };

    let res = await deps.send(params);
    if (!res.success && TRANSIENT.has(res.errorName ?? '')) {
      await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(WELCOME_RETRY_DELAY_MS);
      res = await deps.send(params); // same idempotency key: never two emails
    }

    if (res.success) {
      if (profile) await deps.ledger.finish(account.userId, { ...base, status: 'sent', sent_at: now().toISOString(), ...(res.id ? { provider_id: res.id } : {}) });
      return done('sent', { id: res.id ?? null });
    }
    if (res.errorName === 'suppressed') {
      if (profile) await deps.ledger.finish(account.userId, { ...base, status: 'suppressed', reason: 'suppressed' });
      return done('suppressed');
    }
    // Recorded as failed (not released): nothing re-triggers a welcome later, and a
    // stale record must never let a returning sign-in send one.
    if (profile) await deps.ledger.finish(account.userId, { ...base, status: 'failed', reason: (res.errorName || 'unknown_error').slice(0, 60) });
    return done('failed', { error: res.errorName ?? null, message: (res.error ?? '').slice(0, 120) });
  } catch (err: any) {
    return done('failed', { error: 'exception', message: String(err?.message ?? err).slice(0, 120) });
  }

  function done(outcome: WelcomeOutcome, extra: Record<string, unknown> = {}): WelcomeOutcome {
    log(outcome, account, extra);
    return outcome;
  }
}

// ---------------------------------------------------------------------------
// profiles.metadata ledger
// ---------------------------------------------------------------------------

export class ProfileWelcomeLedger implements WelcomeLedger {
  async load(userId: string): Promise<WelcomeProfile | null> {
    const { data, error } = await createAdminSupabase().from('profiles').select('email, is_admin, metadata').eq('id', userId).maybeSingle();
    if (error) throw new Error(`profile read failed: ${error.message}`);
    if (!data) return null;
    const row = data as { email?: string | null; is_admin?: boolean | null; metadata?: Record<string, any> | null };
    return { email: row.email ?? null, isAdmin: row.is_admin === true, metadata: row.metadata ?? null };
  }

  async claim(userId: string, record: WelcomeRecord): Promise<boolean> {
    const supabase = createAdminSupabase();
    const current = await this.load(userId);
    if (!current || current.metadata?.[WELCOME_METADATA_KEY]) return false;
    const next = { ...(current.metadata ?? {}), [WELCOME_METADATA_KEY]: record };
    const { data, error } = await supabase
      .from('profiles')
      .update({ metadata: next })
      .eq('id', userId)
      .is(`metadata->${WELCOME_METADATA_KEY}`, null)
      .select('id');
    if (error) throw new Error(`welcome claim failed: ${error.message}`);
    return (data ?? []).length === 1;
  }

  async finish(userId: string, record: WelcomeRecord): Promise<void> {
    const supabase = createAdminSupabase();
    const current = await this.load(userId);
    if (!current) return;
    const next = { ...(current.metadata ?? {}), [WELCOME_METADATA_KEY]: record };
    const { error } = await supabase.from('profiles').update({ metadata: next }).eq('id', userId);
    if (error) console.error('[welcome-email] record failed:', userId, error.message);
  }
}

/** Fire-and-forget after the response. Never throws. */
export function triggerWelcomeEmail(account: NewAccount): void {
  runAfterResponse(() => sendWelcomeOnce(account, { ledger: new ProfileWelcomeLedger(), send: sendEmail }), 'welcome-email');
}
