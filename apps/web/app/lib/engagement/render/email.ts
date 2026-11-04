/**
 * Email renderer: EmailContent (typed blocks) → { subject, html, text } in the
 * FitCircle shell. Every CTA goes through `trackedUrl` (UTM + msg params).
 * Pure: the same content renders the same bytes, which keeps previews, dry
 * runs and sends identical.
 */
import { EMAIL_FONT, EMAIL_TOKENS as T, P, cardRow, emailButton, emailShell, esc } from '../../email/brand-shell';
import { trackedUrl, type LinkContext } from '../links';
import type { Accent, ContentBlock, Cta, EmailContent, StatTile } from '../types';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailRenderOptions extends Omit<LinkContext, 'ctaId' | 'content'> {
  /** utm_content for CTAs without their own variant (growth CTAs use the growth variant). */
  content?: string;
  footerLinks?: Array<{ label: string; url: string }>;
  postalAddress?: string | null;
}

const ACCENT: Record<Accent, string> = {
  violet: T.violet,
  orange: T.orange,
  green: T.green,
  cyan: T.cyan,
  pink: T.pink,
  gold: T.gold,
};

const eyebrow = (text: string, color: string = T.pink) =>
  `<p style="margin:0 0 10px 0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${color};">${esc(text)}</p>`;

const h2 = (text: string) =>
  `<p style="margin:0 0 14px 0;font-size:20px;line-height:26px;font-weight:700;color:${T.textPrimary};">${esc(text)}</p>`;

function tileHtml(t: StatTile): string {
  const trendColor = t.trend === 'up' ? T.green : T.textTertiary;
  const arrow = t.trend === 'up' ? '&#8593;&nbsp;' : t.trend === 'down' ? '&#8595;&nbsp;' : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.surface2}" style="background:${T.surface2};border-radius:16px;">
<tr><td class="tile" style="padding:16px 18px 16px 18px;border-left:3px solid ${ACCENT[t.accent]};border-radius:16px;">
<p style="margin:0 0 6px 0;font-size:13px;line-height:18px;color:${T.textSecondary};">${esc(t.label)}</p>
<p class="tilev" style="margin:0;font-size:26px;line-height:32px;font-weight:800;color:${T.textPrimary};letter-spacing:-0.4px;">${esc(t.value)}</p>
${t.delta ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:18px;color:${trendColor};">${arrow}${esc(t.delta)}</p>` : ''}
</td></tr></table>`;
}

function statGrid(tiles: StatTile[]): string {
  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += 2) {
    const [a, b] = [tiles[i], tiles[i + 1]];
    rows.push(`<tr>
<td class="col colpad" width="50%" valign="top" style="width:50%;padding:0 6px 12px 0;">${tileHtml(a)}</td>
<td class="col colpad" width="50%" valign="top" style="width:50%;padding:0 0 12px 6px;">${b ? tileHtml(b) : '&nbsp;'}</td>
</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`;
}

function dot(color: string): string {
  return `<td width="22" valign="top" style="width:22px;padding-top:7px;"><div style="width:10px;height:10px;border-radius:5px;background:${color};font-size:1px;line-height:1px;">&nbsp;</div></td>`;
}

function itemRows(items: Array<{ title: string; detail: string; color: string }>, numbered = false): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .map(
      (it, i) => `<tr>${
        numbered
          ? `<td width="34" valign="top" style="width:34px;padding:2px 0 16px 0;"><div style="width:26px;height:26px;border-radius:13px;background:${T.surface2};border:1px solid ${T.border};color:${T.violet};font-size:13px;line-height:26px;font-weight:800;text-align:center;">${i + 1}</div></td>`
          : dot(it.color)
      }<td valign="top" style="padding:0 0 16px 0;">
<p style="margin:0 0 2px 0;font-size:16px;line-height:22px;font-weight:700;color:${T.textPrimary};">${esc(it.title)}</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${T.textSecondary};">${esc(it.detail)}</p></td></tr>`
    )
    .join('')}</table>`;
}

function blockHtml(b: ContentBlock, link: (cta: Cta, content?: string) => string): string {
  switch (b.kind) {
    case 'hero':
      return cardRow(
        `${b.eyebrow ? eyebrow(b.eyebrow) : ''}<h1 class="h1" style="margin:0 0 12px 0;font-size:30px;line-height:36px;font-weight:800;letter-spacing:-0.6px;color:${T.textPrimary};">${esc(b.title)}</h1>${P(esc(b.body), T.textSecondary, 17)}`,
        '20px 28px 4px 28px'
      );
    case 'celebration':
      return cardRow(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1B1747" style="background:#1B1747;border:1px solid #3B2A78;border-radius:18px;"><tr><td style="padding:20px 22px;">
${eyebrow(b.eyebrow, T.violet)}<p style="margin:0 0 6px 0;font-size:22px;line-height:28px;font-weight:800;color:${T.textPrimary};">${esc(b.title)}</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${T.textSecondary};">${esc(b.body)}</p></td></tr></table>`,
        '16px 28px 0 28px'
      );
    case 'stat_grid':
      return cardRow(`${h2(b.title)}${statGrid(b.tiles)}`, '28px 28px 0 28px');
    case 'circle':
      return cardRow(
        `${h2(b.title)}${itemRows(b.rows.map((r) => ({ title: r.name, detail: r.line, color: T.green })))}`,
        '16px 28px 0 28px'
      );
    case 'goals':
      return cardRow(
        `${h2(b.title)}${b.intro ? P(esc(b.intro), T.textSecondary, 15) : ''}${itemRows(
          b.items.map((g) => ({ ...g, color: T.violet })),
          true
        )}`,
        '16px 28px 0 28px'
      );
    case 'list':
      return cardRow(
        `${b.title ? h2(b.title) : ''}${itemRows(b.items.map((x) => ({ title: x.title, detail: x.detail, color: ACCENT[x.accent] })))}`,
        '16px 28px 0 28px'
      );
    case 'text':
      return cardRow(P(esc(b.body)), '8px 28px 0 28px');
    case 'growth':
      return cardRow(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.surface2}" style="background:${T.surface2};border:1px solid ${T.border};border-radius:18px;"><tr><td style="padding:22px 22px 24px 22px;text-align:center;">
${eyebrow(b.eyebrow)}<p style="margin:0 0 8px 0;font-size:20px;line-height:26px;font-weight:800;color:${T.textPrimary};">${esc(b.title)}</p>
<p style="margin:0 0 10px 0;font-size:15px;line-height:22px;color:${T.textSecondary};">${esc(b.body)}</p>
${emailButton(link(b.cta, b.variant), b.cta.label)}</td></tr></table>`,
        '12px 28px 0 28px'
      );
    case 'cta':
      return cardRow(
        `<div style="text-align:center;">${emailButton(link(b.cta), b.cta.label)}${
          b.note ? `<p style="margin:12px 0 0 0;font-size:13px;line-height:19px;color:${T.textTertiary};">${esc(b.note)}</p>` : ''
        }</div>`,
        '20px 28px 0 28px'
      );
  }
}

function blockText(b: ContentBlock, link: (cta: Cta, content?: string) => string): string[] {
  switch (b.kind) {
    case 'hero':
      return [b.title.toUpperCase(), '', b.body, ''];
    case 'celebration':
      return [`${b.eyebrow}: ${b.title}`, b.body, ''];
    case 'stat_grid':
      return [b.title.toUpperCase(), ...b.tiles.map((t) => `- ${t.label}: ${t.value}${t.delta ? ` (${t.delta})` : ''}`), ''];
    case 'circle':
      return [b.title.toUpperCase(), ...b.rows.map((r) => `- ${r.name}: ${r.line}`), ''];
    case 'goals':
      return [b.title.toUpperCase(), ...(b.intro ? [b.intro] : []), ...b.items.map((g, i) => `${i + 1}. ${g.title} (${g.detail})`), ''];
    case 'list':
      return [...(b.title ? [b.title.toUpperCase()] : []), ...b.items.map((x) => `- ${x.title}: ${x.detail}`), ''];
    case 'text':
      return [b.body, ''];
    case 'growth':
      return [`${b.eyebrow}: ${b.title}`, b.body, `${b.cta.label}: ${link(b.cta, b.variant)}`, ''];
    case 'cta':
      return [`${b.cta.label}: ${link(b.cta)}`, ...(b.note ? [b.note] : []), ''];
  }
}

export function renderEmail(c: EmailContent, o: EmailRenderOptions): RenderedEmail {
  const link = (cta: Cta, content?: string) =>
    trackedUrl(cta.url, { messageKey: o.messageKey, medium: o.medium, sendId: o.sendId, content: content ?? o.content, ctaId: cta.id });
  const greeting = c.greeting
    ? cardRow(`<p style="margin:0;font-size:16px;line-height:24px;color:${T.textSecondary};">${esc(c.greeting)}</p>`, '26px 28px 0 28px')
    : '';
  const body = `${greeting}${c.blocks.map((b) => blockHtml(b, link)).join('\n')}
<tr><td style="padding:0 0 32px 0;font-size:1px;line-height:1px;">&nbsp;</td></tr>`;
  const html = emailShell({
    title: c.subject,
    preheader: c.preheader,
    body,
    footer: { reason: c.footerReason, links: o.footerLinks, postalAddress: o.postalAddress },
  });
  const text = [
    ...(c.greeting ? [c.greeting, ''] : []),
    ...c.blocks.flatMap((b) => blockText(b, link)),
    '--',
    c.footerReason,
    ...(o.footerLinks ?? []).map((l) => `${l.label}: ${l.url}`),
    'FitCircle by Inov8r Labs',
    ...(o.postalAddress ? [o.postalAddress] : []),
  ].join('\n');
  return { subject: c.subject, html, text };
}

/** Exposed for tests: the font stack (Inter first, system fallbacks). */
export const RENDER_FONT = EMAIL_FONT;
