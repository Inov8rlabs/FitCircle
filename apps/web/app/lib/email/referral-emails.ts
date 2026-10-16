/**
 * Referral emails (docs/REFERRALS_SPEC.md §9): the invitation a member sends a
 * friend, the optional reminder (nudge), and the "you both earned a week"
 * reward note. Inline-styled tables only — email clients ignore <style> blocks
 * unevenly. Every function returns { subject, html, text }.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function initialAvatar(name: string, avatarUrl: string | null): string {
  if (avatarUrl && /^https:\/\//i.test(avatarUrl)) {
    return `<img src="${esc(avatarUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:32px;border:3px solid #8b5cf6;margin:0 auto;object-fit:cover;" />`;
  }
  const letter = esc((name.trim()[0] || 'F').toUpperCase());
  return `<div style="width:64px;height:64px;border-radius:32px;margin:0 auto;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#ffffff;font-size:28px;font-weight:800;line-height:64px;text-align:center;">${letter}</div>`;
}

function shell(opts: { preheader: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" /><title>FitCircle</title></head>
<body style="margin:0;padding:0;background:#0b1020;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111833;border:1px solid #232c4d;border-radius:20px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 55%,#ec4899 100%);padding:18px 28px;">
<span style="font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:22px;color:#ffffff;">F</span>
<span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;vertical-align:2px;">&nbsp;FitCircle</span>
</td></tr>
<tr><td style="padding:32px 28px 8px 28px;color:#e8ecf8;">${opts.body}</td></tr>
<tr><td style="padding:8px 28px 28px 28px;color:#7d87a8;font-size:12px;line-height:18px;">${opts.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px auto;"><tr><td align="center" style="border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#ec4899);">
<a href="${esc(href)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;">${esc(label)}</a>
</td></tr></table>`;
}

const HOW_IT_WORKS = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#0d1430;border-radius:14px;">
<tr><td style="padding:16px 18px;font-size:14px;line-height:22px;color:#c9d0ea;">
<b style="color:#ffffff;">What's FitCircle?</b><br/>
A small group of friends who keep each other on track: log meals with a photo, track workouts and steps, keep a streak going, and cheer each other on in your circle's chat. Free on iPhone, Android and the web.
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
  const subject = i.circle ? `${who} saved you a seat in “${i.circle.name}” 💪` : `${who} invited you to FitCircle 💪`;
  const lead = i.circle
    ? `${esc(who)} wants you in <b style="color:#ffffff;">${esc(i.circle.name)}</b>, their circle on FitCircle${i.circle.memberCount > 1 ? ` (${i.circle.memberCount} people so far)` : ''}. It's a small crew that keeps each other honest on workouts, meals and streaks.`
    : `${esc(who)} is using FitCircle to stay on track and wants you along. Fitness sticks when your friends are in it with you.`;
  const reward =
    i.rewardDays > 0
      ? `<p style="margin:16px 0 0 0;font-size:15px;line-height:23px;color:#e8ecf8;">🎁 <b style="color:#ffffff;">Check in on 3 different days and you both get a free week of FitCircle Pro.</b></p>`
      : '';
  const body = `
${initialAvatar(who, i.inviterAvatarUrl)}
<h1 style="margin:16px 0 4px 0;font-size:24px;line-height:30px;font-weight:800;color:#ffffff;text-align:center;">${esc(who)} saved you a seat 💜</h1>
<p style="margin:20px 0 0 0;font-size:15px;line-height:23px;color:#c9d0ea;">${esc(hi)}</p>
<p style="margin:10px 0 0 0;font-size:15px;line-height:23px;color:#c9d0ea;">${lead}</p>
${reward}
${button(i.link, i.circle ? `Join ${who}'s circle` : `Join ${who} on FitCircle`)}
<p style="margin:0;text-align:center;font-size:12px;color:#7d87a8;">or open <a href="${esc(i.link)}" style="color:#a78bfa;">${esc(i.link.replace(/^https:\/\//, ''))}</a></p>
${HOW_IT_WORKS}`;
  const footer = `You're getting this because ${esc(who)} entered your email in FitCircle to invite you. We won't email you again unless they send one reminder.
<a href="${esc(i.unsubscribeUrl)}" style="color:#a78bfa;">Don't send me FitCircle invites</a>.<br/>FitCircle · Inov8r Labs`;
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
  return { subject, html: shell({ preheader: `${who} invited you to FitCircle`, body, footer }), text };
}

export function reminderEmail(i: InviteEmailInput): RenderedEmail {
  const who = i.inviterFirstName;
  const subject = `${who} is still saving your seat 💜`;
  const body = `
${initialAvatar(who, i.inviterAvatarUrl)}
<h1 style="margin:16px 0 4px 0;font-size:22px;line-height:28px;font-weight:800;color:#ffffff;text-align:center;">Your seat is still open</h1>
<p style="margin:20px 0 0 0;font-size:15px;line-height:23px;color:#c9d0ea;">${esc(i.friendName ? `Hey ${i.friendName},` : 'Hey,')} ${esc(who)} asked us to give you a gentle nudge. ${i.circle ? `Their circle <b style="color:#ffffff;">${esc(i.circle.name)}</b> is better with you in it.` : 'Staying on track is easier together.'}</p>
${i.rewardDays > 0 ? `<p style="margin:14px 0 0 0;font-size:15px;line-height:23px;color:#e8ecf8;">🎁 Check in on 3 different days and you both get a free week of Pro.</p>` : ''}
${button(i.link, 'Take my seat')}`;
  const footer = `This is the last reminder unless ${esc(who)} sends another. <a href="${esc(i.unsubscribeUrl)}" style="color:#a78bfa;">Don't send me FitCircle invites</a>.<br/>FitCircle · Inov8r Labs`;
  const text = `${i.friendName ? `Hey ${i.friendName},` : 'Hey,'} ${who} asked us to give you a gentle nudge.${i.rewardDays > 0 ? ' Check in on 3 different days and you both get a free week of Pro.' : ''}\n\nJoin: ${i.link}\n\nDon't want FitCircle invites? ${i.unsubscribeUrl}`;
  return { subject, html: shell({ preheader: `${who} is still saving your seat`, body, footer }), text };
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
  const subject = `You and ${i.friendFirstName} each earned a free week of Pro 🎉`;
  const what =
    i.role === 'inviter'
      ? `${esc(i.friendFirstName)} just checked in for the third day on FitCircle, so your invite paid off for both of you.`
      : `You've checked in on 3 days, so you and ${esc(i.friendFirstName)} both just earned a free week of FitCircle Pro. Thanks for showing up!`;
  const when = i.banked
    ? `Your ${i.days} free days are saved and start automatically when your current plan ends.`
    : `Your ${i.days} days of Pro are active now: unlimited AI meal logging, deeper insights, and every Pro feature.`;
  const body = `
<div style="font-size:48px;line-height:56px;text-align:center;">🎁</div>
<h1 style="margin:8px 0 4px 0;font-size:24px;line-height:30px;font-weight:800;color:#ffffff;text-align:center;">+${i.days} days of Pro for you both</h1>
<p style="margin:20px 0 0 0;font-size:15px;line-height:23px;color:#c9d0ea;">Hi ${esc(i.recipientFirstName)}, ${what}</p>
<p style="margin:10px 0 0 0;font-size:15px;line-height:23px;color:#c9d0ea;">${when}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#0d1430;border-radius:14px;"><tr><td style="padding:16px 18px;font-size:15px;line-height:23px;color:#e8ecf8;">
<b style="color:#ffffff;">Keep it going:</b> every friend you invite who checks in earns you another free week. Bring 100 friends and Pro is yours for life.
</td></tr></table>
${button(i.inviteLink, 'Invite friends')}`;
  const footer = 'You earned this through FitCircle invites. FitCircle · Inov8r Labs';
  const text = `Hi ${i.recipientFirstName},\n\n${what.replace(/<[^>]+>/g, '')}\n${when}\n\nEvery friend you invite who checks in earns you another free week. Bring 100 friends and Pro is yours for life.\n\nInvite friends: ${i.inviteLink}`;
  return { subject, html: shell({ preheader: `+${i.days} days of Pro for you and ${i.friendFirstName}`, body, footer }), text };
}

/** Text for the native SMS composer (sent from the member's own number). */
export function smsInviteBody(inviterFirstName: string, circleName: string | null, link: string, rewardDays: number): string {
  const reward = rewardDays > 0 ? ' Check in 3 days and we both get a free week of Pro.' : '';
  return circleName
    ? `Hey! Join my circle "${circleName}" on FitCircle so we keep each other on track 💪${reward} ${link}`
    : `Hey! I'm using FitCircle to stay on track, join me so we keep each other honest 💪${reward} ${link}`;
}

export function smsReminderBody(circleName: string | null, link: string, rewardDays: number): string {
  const reward = rewardDays > 0 ? ' (3 check-ins and we both get a free week of Pro)' : '';
  return `Still saving you a seat${circleName ? ` in "${circleName}"` : ''} on FitCircle 💜${reward} ${link}`;
}
