import { type NextRequest, NextResponse } from 'next/server';

import { fitCircleAdapters } from '@/lib/engagement/adapters';
import { STREAM_LABEL, unsubscribeUrl, verifyUnsubscribeToken } from '@/lib/engagement/unsubscribe';
import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { fail, ok } from '@/lib/referrals/http';

export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({ interval: 60_000, uniqueTokenPerInterval: 5000, maxRequests: 30 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><meta name="color-scheme" content="dark"/><title>${esc(title)} · FitCircle</title></head>
<body style="margin:0;background:#070A1A;color:#F5F7FF;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<main style="max-width:480px;margin:64px auto;padding:32px 24px;background:#11162A;border:1px solid #232A44;border-radius:24px;text-align:center;">
<div style="font-size:20px;font-weight:800;margin-bottom:16px;">FitCircle</div>
<h1 style="font-size:22px;margin:0 0 12px 0;">${esc(title)}</h1>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const button = (label: string, action: string, secondary = false) =>
  `<form method="post" action="${esc(action)}" style="margin:16px 0 0 0;"><button type="submit" style="width:100%;min-height:48px;padding:14px 28px;border:${secondary ? '1px solid #232A44' : '0'};border-radius:14px;background:${secondary ? '#1A2036' : 'linear-gradient(135deg,#7C3AED,#DB2777)'};color:#fff;font-size:16px;font-weight:700;cursor:pointer;">${esc(label)}</button></form>`;

const wantsJson = (request: NextRequest) => (request.headers.get('accept') ?? '').includes('application/json');

/**
 * GET /api/engagement/unsubscribe?t=&s= — side-effect free (mail scanners
 * prefetch links): validates the token and shows a confirm page.
 */
export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, limiter, getIdentifier(request));
  if (limited) return limited;
  const token = request.nextUrl.searchParams.get('t') ?? '';
  const sendId = request.nextUrl.searchParams.get('s');
  const v = verifyUnsubscribeToken(token);
  if (wantsJson(request)) return v ? ok({ valid: true, scope: v.scope }) : fail(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid');
  if (!v) return page('Link not valid', '<p style="color:#AEB6CC;">This unsubscribe link is not valid. You can manage notifications in the FitCircle app.</p>', 400);
  const here = (scope: 'all' | typeof v.scope) => unsubscribeUrl(v.userId, scope, sendId).replace(/^https:\/\/www\.fitcircle\.ai/, '');
  return page(
    `Unsubscribe from ${STREAM_LABEL[v.scope]}?`,
    `<p style="color:#AEB6CC;line-height:22px;">Account and security emails (like password resets) still arrive.</p>
${button(`Unsubscribe from ${STREAM_LABEL[v.scope]}`, here(v.scope))}
${v.scope !== 'all' ? button('Unsubscribe from all FitCircle tips and updates', here('all'), true) : ''}`
  );
}

/**
 * POST /api/engagement/unsubscribe?t=&s= — performs the opt-out. Used by the
 * confirm buttons and by RFC 8058 one-click (List-Unsubscribe-Post).
 */
export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, limiter, getIdentifier(request));
  if (limited) return limited;
  const v = verifyUnsubscribeToken(request.nextUrl.searchParams.get('t'));
  const sendId = request.nextUrl.searchParams.get('s');
  const isForm = (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded') && !wantsJson(request);
  if (!v) {
    return isForm ? page('Link not valid', '<p style="color:#AEB6CC;">This unsubscribe link is not valid.</p>', 400) : fail(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid');
  }
  const a = fitCircleAdapters();
  try {
    await a.consent.unsubscribe(v.userId, v.scope);
  } catch (err: any) {
    console.error('[engagement/unsubscribe] failed:', err?.message);
    return isForm ? page('Something went wrong', '<p style="color:#AEB6CC;">Please try again in a minute.</p>', 500) : fail(500, 'INTERNAL_SERVER_ERROR', 'Could not unsubscribe');
  }
  let row = null;
  if (sendId && UUID.test(sendId)) {
    try {
      row = await a.ledger.stamp({ sendId }, 'unsubscribed_at', new Date().toISOString(), { unsubscribe_scope: v.scope });
      if (row && row.user_id !== v.userId) row = null;
    } catch (err: any) {
      console.warn('[engagement/unsubscribe] ledger stamp failed:', err?.message);
    }
  }
  a.analytics.track(
    v.userId,
    'Email Unsubscribed',
    {
      scope: v.scope,
      channel: 'email',
      ...(row ? { message_key: row.message_key, variant: row.variant ?? '', period_key: row.period_key, send_id: row.id } : {}),
    },
    row ? `${row.id}:unsubscribed` : undefined
  );
  return isForm
    ? page("You're unsubscribed", `<p style="color:#AEB6CC;">We won't send you ${esc(STREAM_LABEL[v.scope])} anymore.</p>`)
    : ok({ unsubscribed: true, scope: v.scope });
}
