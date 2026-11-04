/**
 * Supabase Auth email templates in the FitCircle frame (docs/EMAIL_QUALITY.md
 * "Supabase Auth templates").
 *
 * Supabase sends these itself (password reset, sign-up confirmation, magic
 * link, email change, invite, reauthentication code), through Resend SMTP.
 * Their HTML lives in the Supabase dashboard (Authentication → Emails →
 * Templates), not in this repo. `scripts/render-auth-email-templates.ts`
 * writes these to supabase/templates/*.html for the owner to paste in.
 *
 * `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}`, `{{ .NewEmail }}`
 * are Supabase (Go template) variables and are left as-is.
 */
import { EMAIL_TOKENS as T, P, cardRow, emailButton, emailShell } from './brand-shell';

export interface AuthTemplate {
  /** Supabase template key (config.toml `[auth.email.template.<key>]`). */
  key: 'confirmation' | 'recovery' | 'magic_link' | 'email_change' | 'invite' | 'reauthentication';
  /** Dashboard name of the template. */
  dashboardName: string;
  subject: string;
  html: string;
}

function page(o: { title: string; preheader: string; heading: string; lead: string; cta?: { label: string; url: string }; code?: boolean; reason: string }): string {
  const rows = [
    cardRow(
      `<h1 class="h1" style="margin:0 0 12px 0;font-size:26px;line-height:32px;font-weight:800;letter-spacing:-0.4px;color:${T.textPrimary};">${o.heading}</h1>
${P(o.lead, T.textSecondary, 16)}`,
      '28px 28px 4px 28px'
    ),
    o.cta ? cardRow(`<div style="text-align:center;">${emailButton(o.cta.url, o.cta.label)}</div>`, '4px 28px 0 28px') : '',
    o.code
      ? cardRow(
          `<p style="margin:8px 0 0 0;text-align:center;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;line-height:40px;font-weight:700;letter-spacing:6px;color:${T.textPrimary};">{{ .Token }}</p>`,
          '4px 28px 0 28px'
        )
      : '',
    cardRow(P("If you didn't ask for this, you can ignore this email. Your account stays as it is.", T.textTertiary, 14), '20px 28px 24px 28px'),
  ].join('\n');
  // `{{ .ConfirmationURL }}` has no characters esc() changes, so it survives the button's escaping verbatim.
  return emailShell({ title: o.title, preheader: o.preheader, body: rows, footer: { reason: o.reason } });
}

export function authEmailTemplates(): AuthTemplate[] {
  const url = '{{ .ConfirmationURL }}';
  const reason = 'You\'re getting this because someone used this email address on FitCircle.';
  return [
    {
      key: 'confirmation',
      dashboardName: 'Confirm signup',
      subject: 'Confirm your FitCircle email',
      html: page({ title: 'Confirm your email', preheader: 'One tap to confirm your FitCircle account.', heading: 'Confirm your email', lead: 'Tap the button to confirm this address and finish creating your FitCircle account.', cta: { label: 'Confirm my email', url }, reason }),
    },
    {
      key: 'recovery',
      dashboardName: 'Reset Password',
      subject: 'Reset your FitCircle password',
      html: page({ title: 'Reset your password', preheader: 'Choose a new FitCircle password.', heading: 'Reset your password', lead: 'Tap the button to choose a new password. The link works once and expires soon.', cta: { label: 'Choose a new password', url }, reason }),
    },
    {
      key: 'magic_link',
      dashboardName: 'Magic Link',
      subject: 'Your FitCircle sign-in link',
      html: page({ title: 'Sign in to FitCircle', preheader: 'Your one-time sign-in link.', heading: 'Sign in to FitCircle', lead: 'Tap the button to sign in. The link works once and expires soon.', cta: { label: 'Sign in', url }, reason }),
    },
    {
      key: 'email_change',
      dashboardName: 'Change Email Address',
      subject: 'Confirm your new FitCircle email',
      html: page({ title: 'Confirm your new email', preheader: 'Confirm the change to your FitCircle email.', heading: 'Confirm your new email', lead: 'Tap the button to change your FitCircle email from {{ .Email }} to {{ .NewEmail }}.', cta: { label: 'Confirm the change', url }, reason }),
    },
    {
      key: 'invite',
      dashboardName: 'Invite user',
      subject: "You're invited to FitCircle",
      html: page({ title: "You're invited to FitCircle", preheader: 'Accept your FitCircle invite.', heading: "You're invited to FitCircle", lead: 'Tap the button to accept the invite and create your account.', cta: { label: 'Accept the invite', url }, reason }),
    },
    {
      key: 'reauthentication',
      dashboardName: 'Reauthentication',
      subject: 'Your FitCircle verification code',
      html: page({ title: 'Your verification code', preheader: 'Your FitCircle verification code.', heading: 'Your verification code', lead: 'Enter this code in FitCircle to confirm it\'s you:', code: true, reason }),
    },
  ];
}
