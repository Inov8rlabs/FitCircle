/**
 * Referral emails (docs/REFERRALS_SPEC.md §9): the invitation a member sends a
 * friend, the optional reminder (nudge), and the "you both earned a week"
 * reward note. Inline-styled tables only — email clients ignore <style> blocks
 * unevenly. Every function returns { subject, html, text }.
 */

import { EMAIL_FONT, EMAIL_TOKENS, emailButton, emailShell, gmailText, solidBg } from './brand-shell';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function initialAvatar(name: string, avatarUrl: string | null): string {
  if (avatarUrl && /^https:\/\//i.test(avatarUrl)) {
    return `<img src="${esc(avatarUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:32px;border:3px solid #8b5cf6;margin:0 auto;object-fit:cover;" />`;
  }
  const letter = esc((name.trim()[0] || 'F').toUpperCase());
  return `<div style="width:64px;height:64px;border-radius:32px;margin:0 auto;background-color:${EMAIL_TOKENS.gradientFrom};background-image:linear-gradient(135deg,${EMAIL_TOKENS.gradientFrom},${EMAIL_TOKENS.gradientTo});color:#ffffff;font-size:28px;font-weight:800;line-height:64px;text-align:center;">${gmailText(letter)}</div>`;
}

/**
 * The shared FitCircle frame (lib/email/brand-shell.ts): real app icon +
 * wordmark header, app colour tokens, no gradient header. `footer` is
 * pre-escaped HTML.
 */
function shell(opts: { title?: string; preheader: string; body: string; footer: string }): string {
  return emailShell({
    title: opts.title ?? 'FitCircle',
    preheader: opts.preheader,
    body: `<tr><td class="px" style="padding:32px 28px 8px 28px;font-family:${EMAIL_FONT};color:#e8ecf8;">${opts.body}</td></tr>`,
    footer: { reason: '', html: opts.footer },
  });
}

/** Primary CTA: the shared bulletproof gradient button (VML fallback for Outlook). */
export function button(href: string, label: string): string {
  return `<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>${emailButton(href, label)}<div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>`;
}

const HOW_IT_WORKS = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;${solidBg(EMAIL_TOKENS.surface2)}border-radius:14px;">
<tr><td style="padding:16px 18px;font-size:14px;line-height:22px;color:#c9d0ea;">
${gmailText(`<b style="color:#ffffff;">What's FitCircle?</b><br/>
A small group of friends who keep each other on track: log meals with a photo, track workouts and steps, keep a streak going, and cheer each other on in your circle's chat. Free on iPhone, Android and the web.`)}
</td></tr></table>`;

export interface InviteEmailInput {
  inviterFirstName: string;
  inviterAvatarUrl: string | null;
  friendName: string | null;
  circle: { name: string; memberCount: number } | null;
  link: string;
  rewardDays: number;
  unsubscribeUrl: string;
}

export function inviteEmail(i: InviteEmailInput): RenderedEmail {
  const who = i.inviterFirstName;
  const hi = i.friendName ? `Hey ${i.friendName},` : 'Hey,';
  const subject = i.circle ? `${who} saved you a seat in “${i.circle.name}”` : `${who} invited you to FitCircle`;
  const lead = i.circle
    ? `${esc(who)} wants you in <b style="color:#ffffff;">${esc(i.circle.name)}</b>, their circle on FitCircle${i.circle.memberCount > 1 ? ` (${i.circle.memberCount} people so far)` : ''}. It's a small crew that keeps each other honest on workouts, meals and streaks.`
    : `${esc(who)} is using FitCircle to stay on track and wants you along. Fitness sticks when your friends are in it with you.`;
  const reward =
    i.rewardDays > 0
      ? `<p style="margin:16px 0 0 0;font-size:15px;line-height:22px;color:#e8ecf8;"><b style="color:#ffffff;">Check in on 3 different days and you both get a free week of FitCircle Pro.</b></p>`
      : '';
  const body = `
${initialAvatar(who, i.inviterAvatarUrl)}
<h1 style="margin:16px 0 4px 0;font-size:24px;line-height:30px;font-weight:800;color:#ffffff;text-align:center;">${esc(who)} saved you a seat</h1>
<p style="margin:20px 0 0 0;font-size:15px;line-height:22px;color:#c9d0ea;">${esc(hi)}</p>
<p style="margin:10px 0 0 0;font-size:15px;line-height:22px;color:#c9d0ea;">${lead}</p>
${reward}
${button(i.link, i.circle ? `Join ${who}'s circle` : `Join ${who} on FitCircle`)}
<p style="margin:0;text-align:center;font-size:12px;color:#AEB6CC;">or open <a href="${esc(i.link)}" style="color:#F5F7FF;text-decoration:underline;">${esc(i.link.replace(/^https:\/\//, ''))}</a></p>
${HOW_IT_WORKS}`;
  const footer = `You're getting this because ${esc(who)} entered your email in FitCircle to invite you. We won't email you again unless they send one reminder.
<a href="${esc(i.unsubscribeUrl)}" style="color:#F5F7FF;text-decoration:underline;">Don't send me FitCircle invites</a>.`;
  const text = [
    hi,
    '',
    i.circle
      ? `${who} wants you in "${i.circle.name}", their circle on FitCircle. It's a small crew that keeps each other honest on workouts, meals and streaks.`
      : `${who} is using FitCircle to stay on track and wants you along.`,
    i.rewardDays > 0 ? '\nCheck in on 3 different days and you both get a free week of FitCircle Pro.' : '',
    '',
    `Join here: ${i.link}`,
    '',
    "FitCircle: small groups of friends who keep each other on track. Free on iPhone, Android and the web.",
    '',
    `Don't want FitCircle invites? ${i.unsubscribeUrl}`,
  ].join('\n');
  return { subject, html: shell({ title: subject, preheader: `${who} invited you to FitCircle`, body, footer }), text };
}

export function reminderEmail(i: InviteEmailInput): RenderedEmail {
  const who = i.inviterFirstName;
  const subject = `${who} is still saving your seat`;
  const body = `
${initialAvatar(who, i.inviterAvatarUrl)}
<h1 style="margin:16px 0 4px 0;font-size:22px;line-height:28px;font-weight:800;color:#ffffff;text-align:center;">Your seat is still open</h1>
<p style="margin:20px 0 0 0;font-size:15px;line-height:22px;color:#c9d0ea;">${esc(i.friendName ? `Hey ${i.friendName},` : 'Hey,')} ${esc(who)} asked us to give you a gentle nudge. ${i.circle ? `Their circle <b style="color:#ffffff;">${esc(i.circle.name)}</b> is better with you in it.` : 'Staying on track is easier together.'}</p>
${i.rewardDays > 0 ? `<p style="margin:14px 0 0 0;font-size:15px;line-height:22px;color:#e8ecf8;">Check in on 3 different days and you both get a free week of Pro.</p>` : ''}
${button(i.link, 'Take my seat')}`;
  const footer = `This is the last reminder unless ${esc(who)} sends another. <a href="${esc(i.unsubscribeUrl)}" style="color:#F5F7FF;text-decoration:underline;">Don't send me FitCircle invites</a>.`;
  const text = `${i.friendName ? `Hey ${i.friendName},` : 'Hey,'} ${who} asked us to give you a gentle nudge.${i.rewardDays > 0 ? ' Check in on 3 different days and you both get a free week of Pro.' : ''}\n\nJoin: ${i.link}\n\nDon't want FitCircle invites? ${i.unsubscribeUrl}`;
  return { subject, html: shell({ title: subject, preheader: `${who} is still saving your seat`, body, footer }), text };
}

export interface RewardEmailInput {
  recipientFirstName: string;
  friendFirstName: string;
  days: number;
  role: 'inviter' | 'invitee';
  banked: boolean;
  inviteLink: string;
}

export function rewardEmail(i: RewardEmailInput): RenderedEmail {
  const subject = `You and ${i.friendFirstName} each earned a free week of Pro`;
  const what =
    i.role === 'inviter'
      ? `${esc(i.friendFirstName)} just checked in for the third day on FitCircle, so your invite paid off for both of you.`
      : `You've checked in on 3 days, so you and ${esc(i.friendFirstName)} both just earned a free week of FitCircle Pro. Thanks for showing up!`;
  const when = i.banked
    ? `Your ${i.days} free days are saved and start automatically when your current plan ends.`
    : `Your ${i.days} days of Pro are active now: unlimited AI meal logging, deeper insights, and every Pro feature.`;
  const body = `
<h1 style="margin:8px 0 4px 0;font-size:24px;line-height:30px;font-weight:800;color:#ffffff;text-align:center;">+${i.days} days of Pro for you both</h1>
<p style="margin:20px 0 0 0;font-size:15px;line-height:22px;color:#c9d0ea;">Hi ${esc(i.recipientFirstName)}, ${what}</p>
<p style="margin:10px 0 0 0;font-size:15px;line-height:22px;color:#c9d0ea;">${when}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;${solidBg(EMAIL_TOKENS.surface2)}border-radius:14px;"><tr><td style="padding:16px 18px;font-size:15px;line-height:22px;color:#e8ecf8;">
${gmailText(`<b style="color:#ffffff;">Keep it going:</b> every friend you invite who checks in earns you another free week. Bring 100 friends and Pro is yours for life.`)}
</td></tr></table>
${button(i.inviteLink, 'Invite friends')}`;
  const footer = 'You earned this through FitCircle invites.';
  const text = `Hi ${i.recipientFirstName},\n\n${what.replace(/<[^>]+>/g, '')}\n${when}\n\nEvery friend you invite who checks in earns you another free week. Bring 100 friends and Pro is yours for life.\n\nInvite friends: ${i.inviteLink}`;
  return { subject, html: shell({ title: subject, preheader: `+${i.days} days of Pro for you and ${i.friendFirstName}`, body, footer }), text };
}

/** Text for the native SMS composer (sent from the member's own number). */
export function smsInviteBody(inviterFirstName: string, circleName: string | null, link: string, rewardDays: number): string {
  const reward = rewardDays > 0 ? ' Check in 3 days and we both get a free week of Pro.' : '';
  return circleName
    ? `Hey! Join my circle "${circleName}" on FitCircle so we keep each other on track.${reward} ${link}`
    : `Hey! I'm using FitCircle to stay on track, join me so we keep each other honest.${reward} ${link}`;
}

export function smsReminderBody(circleName: string | null, link: string, rewardDays: number): string {
  const reward = rewardDays > 0 ? ' (3 check-ins and we both get a free week of Pro)' : '';
  return `Still saving you a seat${circleName ? ` in "${circleName}"` : ''} on FitCircle.${reward} ${link}`;
}
