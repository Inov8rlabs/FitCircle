import { permanentRedirect } from 'next/navigation';

import { ADMIN_TOOLS_ADS_URL } from '@/lib/ads/services/email-report-service';

/** The Ads Console moved to Admin Tools; keep old links working. */
export default function AdminAdsPage() {
  permanentRedirect(ADMIN_TOOLS_ADS_URL);
}
