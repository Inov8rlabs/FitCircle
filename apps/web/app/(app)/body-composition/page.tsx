import { redirect } from 'next/navigation';

import { BodyCompPageClient } from '@/components/body-composition/body-comp-page-client';
import { BodyCompTrendsService } from '@/lib/services/body-comp-trends-service';
import { BodyCompositionService, stripSegmentalData } from '@/lib/services/body-composition-service';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { createServerSupabase } from '@/lib/supabase-server';
import type { BodyCompListResponse, BodyCompLog, BodyCompTrends } from '@/lib/types/body-composition';

export const dynamic = 'force-dynamic';

/**
 * Body Composition journal + trends (BODY_COMP_BUILD_CONTRACT §3/§4). Follows
 * the food-log pattern: server component + cookie auth for the initial reads,
 * then the client shell mutates through the /api/mobile body-comp routes with
 * the Bearer token. Private-only — nothing here feeds any social surface.
 */
export default async function BodyCompositionPage() {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    // Server-resolved entitlement gates so lock states never flash client-side.
    // Everything ships free today; these flip only when Ani flips feature_gates.
    const entitlements = await EntitlementService.getEntitlements(user.id);
    const canLog = entitlements.features['body_comp_logging']?.allowed ?? true;
    const canTrends = entitlements.features['body_comp_trends']?.allowed ?? true;
    const canSegmental = entitlements.features['body_comp_segmental']?.allowed ?? true;

    const emptyList: BodyCompListResponse = { logs: [], hasMore: false, nextBefore: null };
    const [list, latest, trends] = await Promise.all([
        canLog ? BodyCompositionService.listLogs(user.id, { limit: 50 }) : Promise.resolve(emptyList),
        canLog ? BodyCompositionService.getLatest(user.id) : Promise.resolve<BodyCompLog | null>(null),
        canTrends
            ? BodyCompTrendsService.getTrends(user.id).catch((error: unknown): BodyCompTrends | null => {
                  // Trends are decorative on first paint — the client refetches after
                  // the next save; the journal must render regardless.
                  console.error('[body-composition] initial trends fetch failed:', error);
                  return null;
              })
            : Promise.resolve<BodyCompTrends | null>(null),
    ]);

    // Server-side segmental gate enforcement (contract non-negotiable #2): this page
    // reads via the services directly, so it must apply the same strip the /api/mobile
    // routes do — a gated user's initial HTML must not carry segmental payloads.
    const logs = canSegmental ? list.logs : list.logs.map(stripSegmentalData);
    const safeLatest = latest && !canSegmental ? stripSegmentalData(latest) : latest;

    return (
        <BodyCompPageClient
            initialLogs={logs}
            initialHasMore={list.hasMore}
            initialNextBefore={list.nextBefore}
            initialLatest={safeLatest}
            initialTrends={trends}
            entitlements={entitlements}
        />
    );
}
