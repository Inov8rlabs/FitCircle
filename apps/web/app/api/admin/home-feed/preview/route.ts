import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { HomeFeedAdminService } from '@/lib/services/home-feed-admin-service';
import { HomeFeedService } from '@/lib/services/home-feed-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/home-feed/preview?userId=…[&cards=…&platform=ios&version=1.0.8&build=63&timezone=…&includeDisabled=true]
 * → { feed, killSwitch, context, trace, rulesEvaluated }. Read-only: no decision is recorded.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await HomeFeedService.preview(request.nextUrl.searchParams));
  } catch (error) {
    return feedFailFrom(error, 'admin-preview');
  }
}

/**
 * POST /api/admin/home-feed/preview — draft preview for the Admin Tools editor.
 * Body: { userId? | actorAsUser? | persona?: 'typical', platform, version, build?, timezone?, cards?, actions?, promoLayouts?,
 *         draft?: { rules } | { changes } | { revertOf } }
 * → { subject, request, killSwitch, context, before, after, draft: { baseVersion, valid, issues, changes, … }, render }.
 * `before` = the published rules, `after` = the draft, both resolved exactly like GET /api/mobile/home-feed
 * (same context, ranker, guardrails, kill switches). Read-only: nothing is written or recorded.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await HomeFeedAdminService.previewDraft(await readJson(request), caller));
  } catch (error) {
    return feedFailFrom(error, 'admin-preview-draft');
  }
}
