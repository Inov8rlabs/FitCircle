import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, CampaignError } from '@/lib/campaigns/http';
import { welcomeEmail } from '@/lib/email/welcome-email';
import { FitCircleFactsProvider, firstNameOf } from '@/lib/engagement/adapters/fitcircle-facts';
import { LIFECYCLE_STEPS, LIFECYCLE_TEMPLATE } from '@/lib/engagement/messages/lifecycle';
import { buildWeeklyReport } from '@/lib/engagement/messages/weekly-report';
import { appScreenUrl, trackedUrl } from '@/lib/engagement/links';
import { renderEmail } from '@/lib/engagement/render/email';
import { renderPush } from '@/lib/engagement/render/push';
import { isoWeekBounds, isoWeekKey, isoWeekStart, localClock } from '@/lib/engagement/time';
import type { MessagePlan } from '@/lib/engagement/types';
import { STREAM_LABEL, unsubscribeUrl } from '@/lib/engagement/unsubscribe';
import { createAdminSupabase } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/engagement/preview — render a message for a user WITHOUT
 * sending or writing anything (admins only; campaigns admin gate).
 *   ?message=weekly_report (default) | welcome | onboarding_first_meal | … (any lifecycle key)
 *   ?userId=<uuid>   default: the signed-in admin
 *   ?week=2026-W44   weekly report week (default: the current local week)
 *   ?format=html (default, the email as it would arrive) | json (plan + subject + push + text)
 */
export async function GET(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    const q = request.nextUrl.searchParams;
    const userId = q.get('userId') ?? caller.userId;
    if (!userId || !UUID.test(userId)) throw new CampaignError(400, 'USER_REQUIRED', 'Pass ?userId=<uuid>');
    const message = q.get('message') ?? 'weekly_report';
    const format = q.get('format') === 'json' ? 'json' : 'html';
    const facts = new FitCircleFactsProvider();
    const now = new Date();

    let plan: MessagePlan | null = null;
    let extra: Record<string, unknown> = {};
    if (message === 'welcome') {
      const { data: p } = await createAdminSupabase().from('profiles').select('display_name').eq('id', userId).maybeSingle();
      const rendered = welcomeEmail({
        firstName: firstNameOf((p as any)?.display_name, null) || null,
        firstActionUrl: trackedUrl(appScreenUrl('food_log'), { messageKey: 'welcome', medium: 'transactional', ctaId: 'primary' }),
        postalAddress: process.env.EMAIL_POSTAL_ADDRESS || null,
      });
      return format === 'html'
        ? new NextResponse(rendered.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
        : NextResponse.json({ success: true, data: { subject: rendered.subject, text: rendered.text } }, { headers: { 'Cache-Control': 'no-store' } });
    } else if (message === 'weekly_report') {
      const lf = await facts.lifecycleFacts(userId, now);
      if (!lf) throw new CampaignError(404, 'NOT_FOUND', 'User not found');
      const week = q.get('week') ?? isoWeekKey(localClock(lf.profile.timezone, now).date);
      const start = isoWeekStart(week);
      if (!start) throw new CampaignError(400, 'VALIDATION_ERROR', 'week must look like 2026-W44');
      const wf = await facts.weeklyReportFacts(userId, isoWeekBounds(start).start, now);
      if (!wf) throw new CampaignError(404, 'NOT_FOUND', 'User not found');
      const built = buildWeeklyReport(wf);
      if ('skip' in built) {
        return NextResponse.json({ success: true, data: { skipped: built.skip, week } }, { headers: { 'Cache-Control': 'no-store' } });
      }
      plan = built;
      extra = { week, facts: format === 'json' ? wf : undefined };
    } else {
      const step = LIFECYCLE_STEPS.find((s) => s.key === message);
      if (!step) throw new CampaignError(400, 'VALIDATION_ERROR', `Unknown message "${message}"`);
      const lf = await facts.lifecycleFacts(userId, now);
      if (!lf) throw new CampaignError(404, 'NOT_FOUND', 'User not found');
      const due = step.due(lf);
      let built;
      try {
        built = step.build(lf, due ?? 'preview');
      } catch {
        throw new CampaignError(409, 'NOT_APPLICABLE', `${message} doesn't apply to this user right now (due: ${due ?? 'no'})`);
      }
      plan = { messageKey: step.key, periodKey: due ?? 'preview', medium: 'lifecycle', templateVersion: LIFECYCLE_TEMPLATE, variants: built.variants, goalKey: step.goalKey, email: built.email, push: built.push };
      extra = { due: due !== null, periodKey: due };
    }

    const stream = plan.messageKey === 'weekly_report' ? 'weekly_report' : 'tips';
    const rendered = plan.email
      ? renderEmail(plan.email, {
          messageKey: plan.messageKey,
          medium: plan.medium,
          content: plan.variants.hero ?? plan.variants.subject,
          postalAddress: process.env.EMAIL_POSTAL_ADDRESS || null,
          footerLinks: [
            { label: `Unsubscribe from ${STREAM_LABEL[stream]}`, url: unsubscribeUrl(userId, stream) },
            { label: 'Unsubscribe from all', url: unsubscribeUrl(userId, 'all') },
          ],
        })
      : null;
    if (format === 'html' && rendered) {
      return new NextResponse(rendered.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    return NextResponse.json(
      {
        success: true,
        data: {
          ...extra,
          messageKey: plan.messageKey,
          variants: plan.variants,
          meta: plan.meta ?? null,
          subject: rendered?.subject ?? null,
          text: rendered?.text ?? null,
          htmlBytes: rendered ? Buffer.byteLength(rendered.html) : 0,
          push: plan.push ? renderPush(plan.push, plan.messageKey, plan.periodKey) : null,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return campaignFailFrom(error, 'engagement/preview');
  }
}
