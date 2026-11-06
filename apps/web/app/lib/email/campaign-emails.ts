/**
 * Campaign emails (docs/CAMPAIGNS_SPEC.md §6): the shared FitCircle frame
 * (lib/email/brand-shell.ts: app icon + wordmark) plus the campaign's `art.emailHeader` image when
 * present. Body is admin-authored plain text: a blank line starts a new
 * paragraph. Placeholders are rendered by the caller.
 */
import { EMAIL_FONT, emailShell } from './brand-shell';
import { emailPostalAddress } from './compliance';
import { button, esc, type RenderedEmail } from './referral-emails';

export interface CampaignEmailInput {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  emoji?: string | null;
  headerImageUrl?: string | null;
  accent?: string | null;
  unsubscribeUrl: string;
}

const paragraphs = (body: string) =>
  body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

export function campaignEmail(i: CampaignEmailInput): RenderedEmail {
  const headerImage =
    i.headerImageUrl && /^https:\/\//i.test(i.headerImageUrl)
      ? `<tr><td style="padding:0;"><img src="${esc(i.headerImageUrl)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:24px 24px 0 0;" /></td></tr>`
      : '';
  const emoji = !headerImage && i.emoji ? `<div style="font-size:48px;line-height:56px;text-align:center;">${esc(i.emoji)}</div>` : '';
  const paras = paragraphs(i.body)
    .map((p) => `<p style="margin:14px 0 0 0;font-size:15px;line-height:22px;color:#c9d0ea;">${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
  const content = `
${emoji}
<h1 style="margin:8px 0 4px 0;font-size:24px;line-height:30px;font-weight:800;color:#ffffff;text-align:center;">${esc(i.heading)}</h1>
${paras}
${button(i.ctaUrl, i.ctaLabel)}
<p style="margin:0;text-align:center;font-size:12px;color:#AEB6CC;">or open <a href="${esc(i.ctaUrl)}" style="color:#F5F7FF;text-decoration:underline;">${esc(i.ctaUrl.replace(/^https:\/\//, ''))}</a></p>`;
  const footer = `You're getting this because you have a FitCircle account. <a href="${esc(i.unsubscribeUrl)}" style="color:#F5F7FF;text-decoration:underline;">Unsubscribe from FitCircle updates</a>.`;

  const html = emailShell({
    title: i.subject,
    preheader: i.preheader,
    body: `${headerImage}
<tr><td class="px" style="padding:28px 28px 8px 28px;font-family:${EMAIL_FONT};color:#e8ecf8;">${content}</td></tr>`,
    footer: { reason: '', html: footer },
  });

  const text = [i.heading, '', ...paragraphs(i.body).flatMap((p) => [p, '']), `${i.ctaLabel}: ${i.ctaUrl}`, '', `Unsubscribe: ${i.unsubscribeUrl}`, '', 'FitCircle by Inov8r Labs Inc.', ...(emailPostalAddress() ? [emailPostalAddress() as string] : [])].join('\n');
  return { subject: i.subject, html, text };
}
