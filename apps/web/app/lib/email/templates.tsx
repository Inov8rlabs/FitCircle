/**
 * Circle invite email (web share dialog, POST /api/fitcircles/[id]/invite) and
 * the generic notification email (NotificationService).
 *
 * Both use the shared FitCircle frame (lib/email/brand-shell.ts): the real
 * app icon + wordmark, app colour tokens, table layout with inline styles.
 * Every user-provided value (names, circle name, notification copy) is
 * escaped.
 */
import { EMAIL_FONT, EMAIL_TOKENS as T, P, cardRow, emailButton, emailShell, esc, solidBg } from './brand-shell';

// Production domain - use environment variable or fallback to hardcoded value
const PRODUCTION_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.fitcircle.ai';

interface InvitationEmailProps {
  invitedByName: string;
  invitedEmail: string;
  circleName: string;
  circleType: string;
  startDate: string;
  endDate: string;
  participantCount: number;
  inviteCode: string;
}

const CIRCLE_TYPE_LABEL: Record<string, string> = {
  weight_loss: 'Weight loss',
  step_count: 'Steps',
  workout_frequency: 'Workouts',
  custom: 'Custom goal',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function tile(label: string, value: string, color: string): string {
  return `<td class="col" width="50%" valign="top" style="width:50%;padding:0 6px 12px 6px;">
<table role="presentation" class="fc-s2 fc-line" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.surface2}" style="${solidBg(T.surface2)}border:1px solid ${T.border};border-radius:14px;"><tr><td style="padding:14px 16px;text-align:center;font-family:${EMAIL_FONT};">
<p style="margin:0 0 4px 0;font-size:11px;line-height:14px;font-weight:700;letter-spacing:1px;color:${T.textTertiary};">${esc(label)}</p>
<p style="margin:0;font-size:17px;line-height:22px;font-weight:700;color:${color};">${esc(value)}</p>
</td></tr></table></td>`;
}

export function generateInvitationEmail({
  invitedByName,
  circleName,
  circleType,
  startDate,
  endDate,
  participantCount,
  inviteCode,
}: InvitationEmailProps): string {
  const inviteUrl = `${PRODUCTION_URL}/join/${encodeURIComponent(inviteCode)}`;
  const typeLabel = CIRCLE_TYPE_LABEL[circleType] ?? 'Challenge';
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const title = `You're invited to join ${circleName}`;

  const body = [
    cardRow(
      `<p style="margin:0 0 10px 0;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;color:${T.textSecondary};">YOU'RE INVITED</p>
<h1 class="h1" style="margin:0 0 12px 0;font-size:28px;line-height:34px;font-weight:800;letter-spacing:-0.5px;color:${T.textPrimary};">${esc(invitedByName)} wants you in ${esc(circleName)}</h1>
${P(`Check in together and keep each other going. New to FitCircle? You can create a free account as you join.`, T.textSecondary, 16)}`,
      '28px 28px 4px 28px'
    ),
    cardRow(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${tile('TYPE', typeLabel, T.textPrimary)}${tile('MEMBERS', String(participantCount), T.textPrimary)}
</tr>${start || end ? `<tr>${tile('STARTS', start || '–', T.textPrimary)}${tile('ENDS', end || '–', T.textPrimary)}</tr>` : ''}</table>`,
      '12px 22px 0 22px'
    ),
    cardRow(`<div style="text-align:center;">${emailButton(inviteUrl, `Join ${circleName}`)}</div>`, '8px 28px 0 28px'),
    cardRow(
      `<p style="margin:16px 0 0 0;font-size:13px;line-height:20px;color:${T.textTertiary};text-align:center;">Or open this link: <a href="${esc(inviteUrl)}" style="color:${T.textPrimary};text-decoration:underline;word-break:break-all;">${esc(inviteUrl.replace(/^https?:\/\//, ''))}</a><br>Invite code: <b style="color:${T.textSecondary};">${esc(inviteCode)}</b></p>`,
      '0 28px 28px 28px'
    ),
  ].join('\n');

  return emailShell({
    title,
    preheader: `${invitedByName} invited you to ${circleName} on FitCircle.`,
    body,
    footer: { reason: `You're getting this because ${invitedByName} invited this email address to a FitCircle circle.` },
  });
}

interface GenericNotificationEmailProps {
  title: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
  userName?: string;
  footerText?: string;
}

export const generateGenericNotificationEmail = ({
  title,
  body,
  actionUrl,
  actionText = 'View details',
  userName,
  footerText,
}: GenericNotificationEmailProps): string => {
  const paragraphs = body
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => P(esc(line), T.textSecondary, 16))
    .join('');
  const safeAction = actionUrl && /^https:\/\//i.test(actionUrl) ? actionUrl : null;

  const rows = [
    cardRow(
      `${userName ? P(esc(`Hi ${userName},`), T.textSecondary, 16) : ''}
<h1 class="h1" style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:800;color:${T.textPrimary};">${esc(title)}</h1>
${paragraphs}`,
      '28px 28px 4px 28px'
    ),
    ...(safeAction ? [cardRow(`<div style="text-align:center;">${emailButton(safeAction, actionText)}</div>`, '4px 28px 0 28px')] : []),
    cardRow('', '0 28px 24px 28px'),
  ].join('\n');

  return emailShell({
    title,
    preheader: title,
    body: rows,
    footer: { reason: footerText ?? "You're getting this because you have a FitCircle account." },
  });
};
