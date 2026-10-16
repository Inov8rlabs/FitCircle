'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';

import { AnalyticsEvents } from '@/lib/analytics';
import { useTrackOnce } from '@/lib/analytics/react';
import type { CampaignView } from '@/lib/campaigns/types';
import { campaignsWeb, homeCampaign } from '@/lib/campaigns/web-client';
import { STREAK_AUTO_CLAIMED_EVENT } from '@/lib/streaks/auto-claim-events';
import { useAuthStore } from '@/stores/auth-store';

import { CampaignHomeCard } from './CampaignCards';

/**
 * Dashboard card for the homeSlug campaign (CAMPAIGNS_SPEC §10). Renders nothing
 * when there is no campaign or the endpoint fails. Refreshes after any check-in
 * so a daily_calendar card flips to "opened".
 */
export function DashboardCampaignCard() {
  const userId = useAuthStore((s) => s.user?.id);
  const [view, setView] = useState<CampaignView | null>(null);

  const load = useCallback(async () => {
    try {
      setView(homeCampaign(await campaignsWeb.list()));
    } catch {
      setView(null);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void load();
    const onClaim = () => void load();
    window.addEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
    return () => window.removeEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
  }, [userId, load]);

  useTrackOnce(
    view ? AnalyticsEvents.campaignViewed({ campaign: view.slug, template: view.template, surface: 'home_card', phase: view.phase }) : null,
    Boolean(view),
    view ? `${view.slug}:${view.phase}` : ''
  );

  if (!view) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6 sm:mb-8">
      <CampaignHomeCard view={view} className="mx-auto max-w-3xl" />
    </motion.div>
  );
}
