/**
 * GET /api/mobile/app-update - Should this app build ask the user to update?
 *
 * Public (no auth): a force update must reach signed-out users too. The client
 * is identified by the headers every mobile request already carries:
 *   X-App-Platform: ios | android     (X-Platform accepted)
 *   X-App-Version:  1.0.9
 * (`?platform=` / `?version=` override them, for curl checks.)
 *
 * Response envelope: { success, data: AppUpdateDecision, meta, error }
 *   data.status: none | available | recommended | required
 *   data.latest_version / recommended_version / min_supported_version
 *   data.release_notes: { title, subtitle, highlights: [{ icon, title, body }] } | null
 *   data.store: { app_store_id, package_name, url }
 *   data.prompt: { reprompt_after_days, max_prompts_per_version }
 *
 * Policy source: feature_flags row `app_update_policy` (see app-update-service).
 * Any failure answers 200 with status `none` (`meta.degraded: true`): a broken
 * config or DB blip must never block or nag users.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { parseClientPlatform } from '@/lib/experiments/request-info';
import { decideAppUpdate, loadAppUpdateFlag, type AppUpdatePlatform } from '@/lib/services/app-update-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

const NO_STORE = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status, headers: NO_STORE }
  );
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const q = request.nextUrl.searchParams;
  const platform = parseClientPlatform(
    q.get('platform') ?? request.headers.get('x-app-platform') ?? request.headers.get('x-platform')
  );
  if (platform !== 'ios' && platform !== 'android') {
    return errorResponse(400, 'UNSUPPORTED_PLATFORM', 'X-App-Platform must be ios or android');
  }
  const currentVersion = (q.get('version') ?? request.headers.get('x-app-version') ?? '').trim().slice(0, 32) || null;

  let flag = null;
  let degraded = false;
  try {
    flag = await loadAppUpdateFlag(createAdminSupabase());
  } catch (error: unknown) {
    degraded = true;
    console.error('[Mobile API] App update policy load failed:', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const data = decideAppUpdate({ platform: platform as AppUpdatePlatform, currentVersion, flag });
  return NextResponse.json(
    { success: true, data, meta: { requestTime: Date.now() - startTime, ...(degraded ? { degraded } : {}) }, error: null },
    { headers: NO_STORE }
  );
}
