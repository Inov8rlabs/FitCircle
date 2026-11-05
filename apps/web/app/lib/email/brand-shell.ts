/**
 * FitCircle email shell v2 (docs/EMAIL_QUALITY.md §B): the dark,
 * mobile-first frame new emails use — the welcome email today, lifecycle
 * mail (weekly report, onboarding) when it lands.
 *
 * Built for real inboxes, not browsers:
 *  - table layout, 600px max, fluid down to 320px; inline styles everywhere
 *    (the <style> block only adds the mobile/dark-mode refinements, so Gmail
 *    variants that strip it still get a readable 2-column layout);
 *  - bulletproof buttons (VML roundrect for Outlook, solid colour behind the
 *    gradient), ≥ 48px tap targets;
 *  - `color-scheme: dark` so Apple Mail / iOS don't re-invert the palette;
 *  - brand mark = the real app icon (hosted 2x PNG, fixed 40×40, alt text)
 *    + the live "FitCircle" text the website's <Logo> uses. No SVG, no
 *    CSS-drawn logo. With images off you see the alt text on a dark square in
 *    the icon's own navy, next to the live wordmark; no emoji used as icons
 *    (DESIGN_LANGUAGE.md §1);
 *  - the brand gradient is for CTAs only (DESIGN_LANGUAGE.md §3): no
 *    gradient headers or bars.
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
  /** Border of secondary buttons / step badges' ring: a deep violet that reads on surface1. */
  violetBorder: '#4C3A8F',
} as const;

export const EMAIL_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The app icon, email-safe: public/email/fitcircle-icon-40@2x.png (80×80 for a
 * 40×40 slot; built from public/brand/fitcircle-icon-512.png by
 * scripts/build-email-assets.mjs). Absolute https URL on our domain.
 */
export const EMAIL_LOGO_URL = 'https://www.fitcircle.ai/email/fitcircle-icon-40@2x.png';
export const EMAIL_LOGO_PX = 40;
export const EMAIL_LOGO_ALT = 'FitCircle logo';
/** Navy of the icon's own background: the placeholder colour when images are blocked. */
export const EMAIL_LOGO_BG = '#070C2E';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const T = EMAIL_TOKENS;

// ---------------------------------------------------------------------------
// Dark-mode hardening (docs/EMAIL_QUALITY.md "Dark mode").
//
// Gmail iOS (and some Gmail Android builds) "fully invert" HTML email: they
// flip the lightness of every background-color and text colour, which turned
// our dark design light and made the white button label dark-on-purple.
//  1. Backgrounds: Gmail doesn't touch background-IMAGE, so every dark surface
//     also carries `background-image: linear-gradient(c, c)` (solidBg). The
//     bgcolor attribute stays for Outlook.
//  2. Text: every text run is wrapped in the documented Gmail blend spans
//     (gmailText): `u + .body .fc-gs {background:#000; mix-blend-mode:screen}`
//     around `u + .body .fc-gd {background:#000; mix-blend-mode:difference}`.
//     Gmail inverts both the text and those #000 backgrounds; difference then
//     screen restores the original light text. The selector only matches in
//     Gmail (it adds <u></u> before its body wrapper); where colours are not
//     inverted the two blends cancel out. Every emailShell document is passed
//     through protectTextForGmail(), so p/h1/h2/h3 and buttons can't miss it.
//  3. color-scheme "light dark" so Apple Mail / iOS Mail never auto-invert
//     (they keep our explicit dark colours), and [data-ogsc]/[data-ogsb]
//     overrides for Outlook.com.
//  4. Borders can't be gradient-locked: the card's 1px frame is a padded cell
//     with a locked background, dividers are 1px locked rows, and other
//     hairlines (.fc-line) are dropped in Gmail rather than flipped to white.
// ---------------------------------------------------------------------------

/** Inline style for a dark surface Gmail can't invert: colour + same-colour gradient image. */
export const solidBg = (c: string): string => `background-color:${c};background-image:linear-gradient(${c},${c});`;

export const GMAIL_SCREEN_CLASS = 'fc-gs';
export const GMAIL_DIFFERENCE_CLASS = 'fc-gd';

/** Wrap a text run so Gmail's dark-mode inversion is undone (see above). */
export const gmailText = (inner: string): string =>
  `<span class="${GMAIL_SCREEN_CLASS}"><span class="${GMAIL_DIFFERENCE_CLASS}">${inner}</span></span>`;

/** Wrap the content of every p / h1–h3 and button label that isn't wrapped yet. Idempotent. */
export function protectTextForGmail(html: string): string {
  const wrapped = (inner: string) => inner.includes(`class="${GMAIL_SCREEN_CLASS}"`) || inner.trim() === '';
  return html
    .replace(/<(h1|h2|h3|p)\b([^>]*)>([\s\S]*?)<\/\1>/g, (m, tag: string, attrs: string, inner: string) =>
      wrapped(inner) ? m : `<${tag}${attrs}>${gmailText(inner)}</${tag}>`
    )
    .replace(/<a\b([^>]*\bclass="btn2?"[^>]*)>([\s\S]*?)<\/a>/g, (m, attrs: string, inner: string) =>
      wrapped(inner) ? m : `<a${attrs}>${gmailText(inner)}</a>`
    );
}

/** A 1px divider row that survives inversion (locked background, no border). */
export const dividerRow = (color: string = T.border): string =>
  `<tr><td height="1" style="height:1px;line-height:1px;font-size:1px;${solidBg(color)}">&nbsp;</td></tr>`;

/** Bulletproof gradient button (VML fallback for Outlook desktop). */
export function emailButton(href: string, label: string): string {
  const h = esc(href);
  const l = esc(label);
  return `<table role="presentation" class="btnwrap" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0 auto;">
<tr><td align="center" bgcolor="${T.gradientFrom}" style="border-radius:14px;background-color:${T.gradientFrom};background-image:linear-gradient(135deg,${T.gradientFrom} 0%,${T.gradientTo} 100%);">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:52px;v-text-anchor:middle;width:300px;" arcsize="27%" stroke="f" fillcolor="${T.gradientFrom}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${l}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${h}" class="btn" style="display:inline-block;padding:16px 32px;min-width:200px;font-family:${EMAIL_FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;text-align:center;">${gmailText(l)}</a><!--<![endif]-->
</td></tr></table>`;
}

/**
 * Secondary button: solid surface + violet border, ≥ 44 px tall, readable
 * with images off; full width on phones (media query), auto width elsewhere.
 * Bulletproof (VML roundrect for Outlook desktop).
 */
export function emailButtonSecondary(href: string, label: string): string {
  const h = esc(href);
  const l = esc(label);
  return `<table role="presentation" class="btn2wrap" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
<tr><td align="center" class="fc-s2" bgcolor="${T.surface2}" style="border-radius:12px;${solidBg(T.surface2)}border:1px solid ${T.violetBorder};">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="25%" strokecolor="${T.violetBorder}" fillcolor="${T.surface2}"><w:anchorlock/><center style="color:${T.textPrimary};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${l}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${h}" class="btn2" style="display:inline-block;padding:12px 20px;font-family:${EMAIL_FONT};font-size:15px;line-height:20px;font-weight:600;color:${T.textPrimary};text-decoration:none;border-radius:12px;text-align:center;">${gmailText(`${l} &rarr;`)}</a><!--<![endif]-->
</td></tr></table>`;
}

/** Small filled step badge (brand purple, white numeral), sits on the title line. */
export function emailStepBadge(n: number): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="24" height="24" align="center" valign="middle" bgcolor="${T.gradientFrom}" style="width:24px;height:24px;border-radius:12px;${solidBg(T.gradientFrom)}font-family:${EMAIL_FONT};font-size:13px;line-height:24px;font-weight:700;color:#FFFFFF;text-align:center;">${gmailText(String(n))}</td></tr></table>`;
}

/**
 * The FitCircle brand mark for every email: app icon + live wordmark (bold,
 * tight tracking, like the website header). `onLight` for white layouts
 * (internal ads report).
 */
export function emailBrandHeader(opts: { align?: 'left' | 'center'; onLight?: boolean } = {}): string {
  const align = opts.align ?? 'left';
  const textColor = opts.onLight ? '#0F172A' : T.textPrimary;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${align === 'center' ? ' align="center" style="margin:0 auto;"' : ''}><tr>
<td width="${EMAIL_LOGO_PX}" style="width:${EMAIL_LOGO_PX}px;vertical-align:middle;"><img src="${EMAIL_LOGO_URL}" width="${EMAIL_LOGO_PX}" height="${EMAIL_LOGO_PX}" alt="${EMAIL_LOGO_ALT}" style="display:block;width:${EMAIL_LOGO_PX}px;height:${EMAIL_LOGO_PX}px;border:0;outline:none;text-decoration:none;border-radius:9px;background-color:${EMAIL_LOGO_BG};color:${T.textSecondary};font-family:${EMAIL_FONT};font-size:8px;line-height:10px;text-align:center;"></td>
<td style="vertical-align:middle;padding-left:10px;font-family:${EMAIL_FONT};font-size:20px;line-height:24px;font-weight:700;letter-spacing:-0.5px;color:${textColor};" class="fc-wm">${opts.onLight ? 'FitCircle' : gmailText('FitCircle')}</td>
</tr></table>`;
}

export interface ShellFooter {
  /** Why the person gets this email (plain text). */
  reason: string;
  /** Pre-escaped footer HTML used instead of `reason` + `links` (trusted callers only). */
  html?: string;
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
  const doc = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(i.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0!important;padding:0!important;width:100%!important;background:${T.bg};}
/* Gmail (iOS/Android) dark mode: undo text inversion; drop hairlines it would flip to white. */
u + .body .${GMAIL_SCREEN_CLASS}{background:#000;mix-blend-mode:screen;}
u + .body .${GMAIL_DIFFERENCE_CLASS}{background:#000;mix-blend-mode:difference;}
u + .body .fc-line{border-color:transparent!important;}
/* Outlook.com dark mode: keep our dark surfaces and light text. */
[data-ogsb] .fc-bg{background-color:${T.bg}!important;}
[data-ogsb] .cardin{background-color:${T.surface1}!important;}
[data-ogsb] .fc-s2{background-color:${T.surface2}!important;}
[data-ogsc] .btn,[data-ogsc] .btn2{color:#FFFFFF!important;}
[data-ogsc] h1,[data-ogsc] .fc-wm{color:${T.textPrimary}!important;}
[data-ogsc] p{color:${T.textSecondary}!important;}
a{color:${T.textPrimary};}
.btn:hover{opacity:.92;}
@media only screen and (max-width:480px){
  .outer{padding:12px 6px 24px 6px!important;}
  .px{padding-left:22px!important;padding-right:22px!important;}
  .card{border-radius:20px!important;}
  .cardin{border-radius:19px!important;}
  .h1{font-size:24px!important;line-height:30px!important;}
  .tile{padding:12px 12px!important;}
  .tilev{font-size:22px!important;line-height:28px!important;}
  .btnwrap{width:100%!important;}
  .btn{display:block!important;min-width:0!important;padding-left:16px!important;padding-right:16px!important;}
  .btn2wrap{width:100%!important;}
  .btn2{display:block!important;}
}
@media only screen and (max-width:360px){
  .px{padding-left:18px!important;padding-right:18px!important;}
}
@media only screen and (max-width:350px){
  .col{display:block!important;width:100%!important;max-width:100%!important;}
  .colpad{padding:0 0 12px 0!important;}
}
</style>
</head>
<body class="body" style="margin:0;padding:0;${solidBg(T.bg)}-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(i.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" class="fc-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.bg}" style="${solidBg(T.bg)}">
<tr><td class="outer" align="center" style="padding:24px 8px 32px 8px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${EMAIL_FONT};">
<tr><td class="px" style="padding:4px 28px 20px 28px;">
${emailBrandHeader()}
</td></tr>
<tr><td class="card" bgcolor="${T.border}" style="padding:1px;border-radius:24px;${solidBg(T.border)}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="cardin" bgcolor="${T.surface1}" style="border-radius:23px;${solidBg(T.surface1)}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${i.body}
</table>
</td></tr></table>
</td></tr>
<tr><td class="px" style="padding:24px 28px 0 28px;font-family:${EMAIL_FONT};font-size:13px;line-height:20px;color:${T.textTertiary};text-align:center;">
${gmailText(`${i.footer.html ?? `${esc(i.footer.reason)}${links ? `<br><br>${links}` : ''}`}
<br><br>FitCircle by Inov8r Labs${i.footer.postalAddress ? `<br>${esc(i.footer.postalAddress)}` : ''}`)}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
  return protectTextForGmail(doc);
}

/** A padded card row. */
export const cardRow = (inner: string, pad = '24px 28px 0 28px') =>
  `<tr><td class="px" style="padding:${pad};font-family:${EMAIL_FONT};">${inner}</td></tr>`;

export const P = (text: string, color: string = T.textSecondary, size = 16) =>
  `<p style="margin:0 0 14px 0;font-size:${size}px;line-height:${Math.round(size * 1.45)}px;color:${color};">${text}</p>`;
