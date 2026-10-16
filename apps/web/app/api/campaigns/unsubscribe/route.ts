import { type NextRequest, NextResponse } from 'next/server';

import { verifyCampaignUnsubscribeToken } from '@/lib/campaigns/unsubscribe';
import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { fail, ok } from '@/lib/referrals/http';
import { CampaignDeliveryService } from '@/lib/services/campaign-delivery-service';

export const dynamic = 'force-dynamic';

const limiter = createRateLimiter({ interval: 60_000, uniqueTokenPerInterval: 5000, maxRequests: 30 });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${esc(title)} · FitCircle</title></head>
<body style="margin:0;background:#0b1020;color:#e8ecf8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<main style="max-width:480px;margin:64px auto;padding:32px 24px;background:#111833;border:1px solid #232c4d;border-radius:20px;text-align:center;">
<div style="font-size:20px;font-weight:800;margin-bottom:16px;">FitCircle</div>
<h1 style="font-size:22px;margin:0 0 12px 0;">${esc(title)}</h1>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const wantsJson = (request: NextRequest) => (request.headers.get('accept') ?? '').includes('application/json');

/**
 * GET /api/campaigns/unsubscribe?t= — public and side-effect free (mail
 * scanners prefetch links): validates the token and shows a confirm page whose
 * button POSTs back here.
 */
export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, limiter, getIdentifier(request));
  if (limited) return limited;
  const token = request.nextUrl.searchParams.get('t') ?? '';
  const valid = !!verifyCampaignUnsubscribeToken(token);
  if (wantsJson(request)) return valid ? ok({ valid: true }) : fail(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid');
  if (!valid) return page('Link not valid', '<p style="color:#c9d0ea;">This unsubscribe link is not valid. You can turn off FitCircle emails in the app settings.</p>', 400);
  return page(
    'Unsubscribe from FitCircle updates?',
    `<p style="color:#c9d0ea;line-height:22px;">You'll stop getting campaign and news emails. Account and security emails still arrive.</p>
<form method="post" action="/api/campaigns/unsubscribe?t=${encodeURIComponent(token)}">
<button type="submit" style="margin-top:16px;padding:14px 28px;border:0;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Unsubscribe</button>
</form>`
  );
}

/**
 * POST /api/campaigns/unsubscribe?t= — performs the opt-out
 * (profiles.preferences.marketingEmails = false). Used by the confirm button
 * and by RFC 8058 one-click (List-Unsubscribe-Post).
 */
export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, limiter, getIdentifier(request));
  if (limited) return limited;
  const userId = verifyCampaignUnsubscribeToken(request.nextUrl.searchParams.get('t'));
  const isForm = (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded') && !wantsJson(request);
  if (!userId) {
    return isForm ? page('Link not valid', '<p style="color:#c9d0ea;">This unsubscribe link is not valid.</p>', 400) : fail(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid');
  }
  try {
    await CampaignDeliveryService.optOut(userId);
  } catch (err: any) {
    console.error('[campaigns/unsubscribe] failed:', err?.message);
    return isForm ? page('Something went wrong', '<p style="color:#c9d0ea;">Please try again in a minute.</p>', 500) : fail(500, 'INTERNAL_SERVER_ERROR', 'Could not unsubscribe');
  }
  return isForm
    ? page("You're unsubscribed", '<p style="color:#c9d0ea;">We won\'t send you FitCircle campaign emails anymore.</p>')
    : ok({ unsubscribed: true });
}
