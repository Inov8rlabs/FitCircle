'use client';

import { EngagePlacement, useHeroDecision } from './WebEngage';

/** home_hero slot: the campaign experience card, or the hero content card when it outranks it. */
export function DashboardHero({ campaign }: { campaign: React.ReactNode }) {
  const { showCampaign } = useHeroDecision();
  if (showCampaign) return <>{campaign}</>;
  return <EngagePlacement placement="home_hero" className="mx-auto mb-6 max-w-3xl sm:mb-8" />;
}
