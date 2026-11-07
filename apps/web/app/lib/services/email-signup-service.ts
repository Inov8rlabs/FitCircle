/**
 * Email + password sign-up through the Auth admin API (service role).
 *
 * Accounts are created with `auth.admin.createUser`, so public sign-up can be switched
 * off in Supabase Auth: nothing outside our register routes can create an email account.
 *
 * Confirmation mirrors the Supabase project setting, which the admin API does not apply
 * by itself. AUTH_SIGNUP_CONFIRM_EMAIL unset/false (Supabase "Confirm email" off, i.e.
 * autoconfirm): the account is created confirmed and no confirmation email is sent, as
 * `signUp` did. AUTH_SIGNUP_CONFIRM_EMAIL=true ("Confirm email" on): the account is
 * created unconfirmed, the link comes from `auth.admin.generateLink({type: 'signup'})`
 * and is mailed by us in the FitCircle template the dashboard holds
 * (lib/email/auth-templates.ts); if that fails, Supabase's own resend is tried.
 */

/** Must the person confirm their email before signing in? (keep in step with Supabase Auth) */
export function signupRequiresConfirmation(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AUTH_SIGNUP_CONFIRM_EMAIL ?? '').trim().toLowerCase() === 'true';
}
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { authEmailTemplates } from '@/lib/email/auth-templates';
import { esc } from '@/lib/email/brand-shell';
import { sendEmail } from '@/lib/email/email-service';
import { canonicalEmail } from '@/lib/validation/email-canonical';

export type SignupFailure =
  | { kind: 'exists'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

export type SignupResult = { ok: true; user: User } | { ok: false; failure: SignupFailure };

export const ACCOUNT_EXISTS_MESSAGE = 'An account with this email already exists. Sign in instead, or reset your password.';

function isExists(error: { code?: string; message?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  const text = (error.message ?? '').toLowerCase();
  return text.includes('already been registered') || text.includes('already registered') || text.includes('already exists');
}

/**
 * Create an email account (confirmed unless `requireConfirmation`). Sends nothing:
 * call sendSignupConfirmation when confirmation is required.
 */
export async function createEmailAccount(
  supabase: SupabaseClient,
  input: { email: string; password: string; metadata?: Record<string, unknown>; requireConfirmation?: boolean }
): Promise<SignupResult> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: !(input.requireConfirmation ?? signupRequiresConfirmation()),
    user_metadata: input.metadata ?? {},
  });
  if (error || !data?.user) {
    if (isExists(error)) return { ok: false, failure: { kind: 'exists', message: ACCOUNT_EXISTS_MESSAGE } };
    const status = (error as { status?: number } | null)?.status;
    const message = error?.message || 'Failed to create account';
    // GoTrue validation (weak password, invalid email) answers 400/422.
    if (status === 400 || status === 422) return { ok: false, failure: { kind: 'invalid', message } };
    return { ok: false, failure: { kind: 'error', message } };
  }
  return { ok: true, user: data.user };
}

/** The confirmation email, from the same template the Supabase dashboard holds. */
export function confirmationEmail(actionLink: string): { subject: string; html: string; text: string } {
  const tpl = authEmailTemplates().find((t) => t.key === 'confirmation')!;
  return {
    subject: tpl.subject,
    html: tpl.html.split('{{ .ConfirmationURL }}').join(esc(actionLink)),
    text: `Confirm your FitCircle email: ${actionLink}\n\nIf you didn't ask for this, you can ignore this email.`,
  };
}

/**
 * Send the sign-up confirmation for an account created by createEmailAccount.
 * Never throws; returns how it was sent.
 */
export async function sendSignupConfirmation(
  supabase: SupabaseClient,
  input: { email: string; password: string; redirectTo?: string; userId?: string }
): Promise<'sent' | 'supabase_resend' | 'failed'> {
  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'signup',
      email: input.email,
      password: input.password,
      ...(input.redirectTo ? { options: { redirectTo: input.redirectTo } } : {}),
    });
    const link = data?.properties?.action_link;
    if (!error && link) {
      const mail = confirmationEmail(link);
      const sent = await sendEmail({
        to: input.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        category: 'auth',
        tags: { kind: 'signup_confirmation' },
        ...(input.userId ? { idempotencyKey: `signup-confirm:${input.userId}` } : {}),
      });
      if (sent.success) return 'sent';
      console.warn('[signup] confirmation send failed:', sent.errorName ?? sent.error);
    } else {
      console.warn('[signup] generateLink failed:', error?.message ?? 'no link');
    }
  } catch (err: any) {
    console.warn('[signup] confirmation threw:', err?.message ?? err);
  }
  // Fallback: Supabase's own confirmation email (its SMTP + template).
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: input.email,
      ...(input.redirectTo ? { options: { emailRedirectTo: input.redirectTo } } : {}),
    });
    if (!error) return 'supabase_resend';
    console.error('[signup] Supabase resend fallback failed:', error.message);
  } catch (err: any) {
    console.error('[signup] Supabase resend fallback threw:', err?.message ?? err);
  }
  return 'failed';
}

/**
 * profiles.email_canonical (migration 132). Separate best-effort write so a missing
 * column never fails the insert that creates the profile.
 */
export async function setEmailCanonical(supabase: SupabaseClient, userId: string, email: string | null | undefined): Promise<void> {
  const canonical = canonicalEmail(email);
  if (!canonical) return;
  try {
    const { error } = await supabase.from('profiles').update({ email_canonical: canonical }).eq('id', userId);
    if (error) console.warn('[signup] email_canonical update failed:', error.message);
  } catch (err: any) {
    console.warn('[signup] email_canonical update threw:', err?.message ?? err);
  }
}
