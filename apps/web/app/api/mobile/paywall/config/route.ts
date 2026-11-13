/**
 * GET /api/mobile/paywall/config - Which plan a paywall pre-selects, and which row gets
 * the "Most popular" badge (docs/PAYWALL_DEFAULT_PLAN.md).
 *
 * Auth optional: the onboarding paywall can open before sign-up completes. A valid
 * Bearer token (or web session) adds the user to the remote config ctx; no token, or an
 * invalid one, resolves anonymously (admin defaults + platform / app version / country
 * rules; user-scoped rule conditions never match).
 *
 * Serves ONLY the two registry keys below, by name: the request can't pick a key.
 *
 * Response: { success, data: { defaultPlan, badgePlan }, meta, error }, Cache-Control: no-store.
 * Never fails because of config: any internal error answers 200 with the code defaults
 * (`meta.degraded: true`).
 */
import { type NextRequest, NextResponse } from 'next/server';

import { readExperimentRequestInfo } from '@/lib/experiments/request-info';
import { verifyMobileAuth } from '@/lib/middleware/mobile-auth';
import { RemoteConfigService, codeDefault, type RemoteConfigContext } from '@/lib/remote-config';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let degraded = false;
  let defaultPlan = codeDefault('paywall_default_plan') as string;
  let badgePlan = codeDefault('paywall_badge_plan') as string;

  try {
    let userId: string | null = null;
    try {
      const user = await verifyMobileAuth(request);
      userId = typeof user?.id === 'string' ? user.id : null;
    } catch (authError: unknown) {
      // Auth trouble → anonymous, never an error.
      console.warn('[Mobile API] Paywall config auth failed; resolving anonymously:', authError instanceof Error ? authError.message : String(authError));
      userId = null;
    }
    const info = readExperimentRequestInfo(request);
    const ctx: RemoteConfigContext = {
      userId,
      platform: info.platform,
      appVersion: info.appVersion,
      country: info.ipCountry,
    };
    [defaultPlan, badgePlan] = await Promise.all([
      RemoteConfigService.enumValue('paywall_default_plan', ctx),
      RemoteConfigService.enumValue('paywall_badge_plan', ctx),
    ]);
  } catch (error: unknown) {
    degraded = true;
    console.error('[Mobile API] Paywall config failed; serving code defaults:', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return NextResponse.json(
    {
      success: true,
      data: { defaultPlan, badgePlan },
      error: null,
      meta: { requestTime: Date.now() - startTime, ...(degraded ? { degraded } : {}) },
    },
    { headers: NO_STORE }
  );
}
