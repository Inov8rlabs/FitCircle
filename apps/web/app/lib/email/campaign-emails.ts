/**
 * Campaign emails (docs/CAMPAIGNS_SPEC.md §6): the referral email shell (dark
 * card, gradient header) plus the campaign's `art.emailHeader` image when
 * present. Body is admin-authored plain text: a blank line starts a new
 * paragraph. Placeholders are rendered by the caller.
 */
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
      ? `<tr><td style="padding:0;"><img src="${esc(i.headerImageUrl)}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;" /></td></tr>`
      : '';
  const emoji = !headerImage && i.emoji ? `<div style="font-size:48px;line-height:56px;text-align:center;">${esc(i.emoji)}</div>` : '';
  const paras = paragraphs(i.body)
    .map((p) => `<p style="margin:14px 0 0 0;font-size:15px;line-height:23px;color:#c9d0ea;">${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
  const content = `
${emoji}
<h1 style="margin:8px 0 4px 0;font-size:24px;line-height:30px;font-weight:800;color:#ffffff;text-align:center;">${esc(i.heading)}</h1>
${paras}
${button(i.ctaUrl, i.ctaLabel)}
<p style="margin:0;text-align:center;font-size:12px;color:#7d87a8;">or open <a href="${esc(i.ctaUrl)}" style="color:#a78bfa;">${esc(i.ctaUrl.replace(/^https:\/\//, ''))}</a></p>`;
  const footer = `You're getting this because you have a FitCircle account. <a href="${esc(i.unsubscribeUrl)}" style="color:#a78bfa;">Unsubscribe from FitCircle updates</a>.<br/>FitCircle · Inov8r Labs`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" /><title>${esc(i.subject)}</title></head>
<body style="margin:0;padding:0;background:#0b1020;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111833;border:1px solid #232c4d;border-radius:20px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 55%,#ec4899 100%);padding:18px 28px;">
<span style="font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:22px;color:#ffffff;">F</span>
<span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;vertical-align:2px;">&nbsp;FitCircle</span>
</td></tr>
${headerImage}
<tr><td style="padding:28px 28px 8px 28px;color:#e8ecf8;">${content}</td></tr>
<tr><td style="padding:8px 28px 28px 28px;color:#7d87a8;font-size:12px;line-height:18px;">${footer}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [i.heading, '', ...paragraphs(i.body).flatMap((p) => [p, '']), `${i.ctaLabel}: ${i.ctaUrl}`, '', `Unsubscribe: ${i.unsubscribeUrl}`].join('\n');
  return { subject: i.subject, html, text };
}
