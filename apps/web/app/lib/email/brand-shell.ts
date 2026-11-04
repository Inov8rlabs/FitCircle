/**
 * FitCircle email shell v2 (docs/ENGAGEMENT_MESSAGING.md §6): the dark,
 * mobile-first frame every new email uses — transactional (welcome) and
 * lifecycle (weekly report, onboarding) alike.
 *
 * Built for real inboxes, not browsers:
 *  - table layout, 600px max, fluid down to 320px; inline styles everywhere
 *    (the <style> block only adds the mobile/dark-mode refinements, so Gmail
 *    variants that strip it still get a readable 2-column layout);
 *  - bulletproof buttons (VML roundrect for Outlook, solid colour behind the
 *    gradient), ≥ 48px tap targets;
 *  - `color-scheme: dark` so Apple Mail / iOS don't re-invert the palette;
 *  - the logo is a hosted PNG with alt text; the email reads fine with
 *    images off; no emoji used as icons (DESIGN_LANGUAGE.md §1).
 *
 * Colours are the app tokens (DESIGN_LANGUAGE.md §3).
 */

export const EMAIL_TOKENS = {
  bg: '#070A1A',
  surface1: '#11162A',
  surface2: '#1A2036',
  border: '#232A44',
  textPrimary: '#F5F7FF',
  textSecondary: '#AEB6CC',
  textTertiary: '#8E97AE',
  gradientFrom: '#7C3AED',
  gradientTo: '#DB2777',
  violet: '#A78BFA',
  orange: '#F97316',
  green: '#22C55E',
  cyan: '#22D3EE',
  pink: '#F472B6',
  gold: '#F59E0B',
} as const;

export const EMAIL_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Hosted app icon (public/icons). Absolute so it works in every client. */
export const EMAIL_LOGO_URL = 'https://www.fitcircle.ai/icons/icon-96x96.png';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const T = EMAIL_TOKENS;

/** Bulletproof gradient button (VML fallback for Outlook desktop). */
export function emailButton(href: string, label: string): string {
  const h = esc(href);
  const l = esc(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0 auto;">
<tr><td align="center" bgcolor="${T.gradientFrom}" style="border-radius:14px;background-color:${T.gradientFrom};background-image:linear-gradient(135deg,${T.gradientFrom} 0%,${T.gradientTo} 100%);">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:52px;v-text-anchor:middle;width:300px;" arcsize="27%" stroke="f" fillcolor="${T.gradientFrom}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${l}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${h}" class="btn" style="display:inline-block;padding:16px 32px;min-width:200px;font-family:${EMAIL_FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;text-align:center;">${l}</a><!--<![endif]-->
</td></tr></table>`;
}

export interface ShellFooter {
  /** Why the person gets this email (plain text). */
  reason: string;
  /** Unsubscribe links (engagement email only). */
  links?: Array<{ label: string; url: string }>;
  /** CAN-SPAM postal address (EMAIL_POSTAL_ADDRESS). */
  postalAddress?: string | null;
}

export interface ShellInput {
  title: string;
  preheader: string;
  /** Inner HTML of the card (rows built by the caller). */
  body: string;
  footer: ShellFooter;
}

const PREHEADER_PAD = '&#847;&zwnj;&nbsp;'.repeat(40);

/** Full HTML document around a card body. */
export function emailShell(i: ShellInput): string {
  const links = (i.footer.links ?? [])
    .map((l) => `<a href="${esc(l.url)}" style="color:${T.textSecondary};text-decoration:underline;">${esc(l.label)}</a>`)
    .join('&nbsp;&nbsp;·&nbsp;&nbsp;');
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(i.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:dark;supported-color-schemes:dark;}
body{margin:0!important;padding:0!important;width:100%!important;background:${T.bg};}
a{color:${T.violet};}
.btn:hover{opacity:.92;}
@media only screen and (max-width:480px){
  .px{padding-left:20px!important;padding-right:20px!important;}
  .h1{font-size:26px!important;line-height:32px!important;}
  .tile{padding:14px 14px!important;}
  .tilev{font-size:23px!important;line-height:28px!important;}
  .btn{min-width:0!important;padding-left:24px!important;padding-right:24px!important;}
}
@media only screen and (max-width:350px){
  .col{display:block!important;width:100%!important;max-width:100%!important;}
  .colpad{padding:0 0 12px 0!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${T.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(i.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.bg}" style="background:${T.bg};">
<tr><td align="center" style="padding:24px 12px 32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${EMAIL_FONT};">
<tr><td class="px" style="padding:4px 28px 20px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;"><img src="${EMAIL_LOGO_URL}" width="36" height="36" alt="F" style="display:block;width:36px;height:36px;border:0;border-radius:10px;background-color:${T.gradientFrom};background-image:linear-gradient(135deg,${T.gradientFrom} 0%,${T.gradientTo} 100%);color:#ffffff;font-family:Georgia,serif;font-style:italic;font-size:22px;line-height:36px;font-weight:700;text-align:center;"></td>
<td style="vertical-align:middle;padding-left:10px;font-family:${EMAIL_FONT};font-size:19px;line-height:24px;font-weight:800;letter-spacing:-0.3px;color:${T.textPrimary};">FitCircle</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${T.surface1}" style="background:${T.surface1};border:1px solid ${T.border};border-radius:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="4" style="height:4px;line-height:4px;font-size:4px;border-radius:24px 24px 0 0;background-color:${T.gradientFrom};background-image:linear-gradient(90deg,${T.gradientFrom} 0%,${T.gradientTo} 100%);">&nbsp;</td></tr>
${i.body}
</table>
</td></tr>
<tr><td class="px" style="padding:24px 28px 0 28px;font-family:${EMAIL_FONT};font-size:13px;line-height:20px;color:${T.textTertiary};text-align:center;">
${esc(i.footer.reason)}${links ? `<br><br>${links}` : ''}
<br><br>FitCircle by Inov8r Labs${i.footer.postalAddress ? `<br>${esc(i.footer.postalAddress)}` : ''}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

/** A padded card row. */
export const cardRow = (inner: string, pad = '24px 28px 0 28px') =>
  `<tr><td class="px" style="padding:${pad};font-family:${EMAIL_FONT};">${inner}</td></tr>`;

export const P = (text: string, color: string = T.textSecondary, size = 16) =>
  `<p style="margin:0 0 14px 0;font-size:${size}px;line-height:${Math.round(size * 1.55)}px;color:${color};">${text}</p>`;
