/**
 * Web app access to the viewer-facing campaign endpoints (CAMPAIGNS_SPEC §3).
 * The /api/mobile routes authenticate with Bearer OR the web session cookie
 * (verifyMobileAuth), and `x-client-timezone` anchors the viewer's local day.
 */

import { apiRequest } from './admin-client';
import type { CampaignView, CampaignsResponse } from './types';

const KNOWN_TEMPLATES = new Set(['seasonal_circle', 'daily_calendar', 'spotlight']);

/** Forward compatible: unknown templates are skipped (§1). */
export function visibleCampaigns(res: CampaignsResponse | null | undefined): CampaignView[] {
  return (res?.campaigns ?? []).filter((c) => c && KNOWN_TEMPLATES.has(c.template));
}

export function homeCampaign(res: CampaignsResponse | null | undefined): CampaignView | null {
  const list = visibleCampaigns(res);
  if (!res?.homeSlug) return null;
  return list.find((c) => c.slug === res.homeSlug) ?? null;
}

export const campaignsWeb = {
  list: () => apiRequest<CampaignsResponse>('/api/mobile/campaigns'),
  get: (slug: string) => apiRequest<CampaignView>(`/api/mobile/campaigns/${encodeURIComponent(slug)}`),
  participate: (slug: string, body: { joined?: boolean; reminders?: boolean }) =>
    apiRequest<CampaignView>(`/api/mobile/campaigns/${encodeURIComponent(slug)}/participation`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
