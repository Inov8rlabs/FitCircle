/**
 * Read side of Ads → Keywords (docs/ADS_METRICS_METHODOLOGY.md §10): the
 * overview's delivery, entities and sign-up cohort (AdsReportService — same
 * range, time zone, attribution and test-user exclusion) plus each cohort
 * user's onboarding paywall timestamp, handed to the pure lib/ads/keyword-funnel.ts.
 * Read-only: never calls a network or writes anything.
 */
import { CampaignError } from '@/lib/campaigns/http';

import { FUNNEL_DEFINITIONS } from '../definitions';
import { buildKeywordFunnel, FUNNEL_LEVELS_BY_CHANNEL, MIN_SIGNUPS_TO_JUDGE } from '../keyword-funnel';
import type { CohortUser } from '../metrics';
import { effectiveAttribution } from '../report';
import { AD_CHANNELS, FUNNEL_LEVELS, type AdChannel, type AdsKeywordFunnel, type FunnelLevel } from '../types';

import { chunk, db, selectAll } from './db';
import { AdsReportService, type RangeQuery } from './report-service';
import { AdsSyncService } from './sync-service';

export function parseFunnelChannel(v: string | null): AdChannel {
  if (!v) return 'apple_ads';
  if (!(AD_CHANNELS as string[]).includes(v)) throw new CampaignError(400, 'VALIDATION_ERROR', `channel must be one of ${AD_CHANNELS.join(', ')}`);
  return v as AdChannel;
}

export function parseFunnelLevel(v: string | null, channel: AdChannel): FunnelLevel {
  const supported = FUNNEL_LEVELS_BY_CHANNEL[channel];
  if (!v) return supported[0];
  if (!(FUNNEL_LEVELS as string[]).includes(v)) throw new CampaignError(400, 'VALIDATION_ERROR', `level must be one of ${FUNNEL_LEVELS.join(', ')}`);
  if (!supported.includes(v as FunnelLevel)) {
    throw new CampaignError(400, 'VALIDATION_ERROR', `${channel} attribution has no ${v.replace('_', ' ')}; use level=${supported.join(' or ')}`);
  }
  return v as FunnelLevel;
}

export class AdsKeywordFunnelService {
  /** Ids of the given users that reached the onboarding paywall (profiles.onboarding_paywall_at set). */
  static async paywallUsers(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunk([...new Set(ids)], 150)) {
      const rows = await selectAll<{ id: string; onboarding_paywall_at: string | null }>(() =>
        db().from('profiles').select('id, onboarding_paywall_at').in('id', part).order('id', { ascending: true })
      );
      for (const r of rows) if (r.onboarding_paywall_at) out.add(r.id);
    }
    return out;
  }

  static async report(range: RangeQuery, channel: AdChannel, level: FunnelLevel): Promise<AdsKeywordFunnel> {
    const [metricRows, entities, cohortResult, status] = await Promise.all([
      AdsReportService.loadMetrics(range.start, range.end),
      AdsReportService.loadEntities({ channel }),
      AdsReportService.reportCohort(range),
      AdsSyncService.status(),
    ]);
    const { cohort, excluded } = cohortResult;
    const inChannel = (u: CohortUser) => effectiveAttribution(u)?.channel === channel;
    const paywallUsers = await this.paywallUsers(cohort.filter(inChannel).map((u) => u.userId));
    const built = buildKeywordFunnel({
      metricRows: metricRows.filter((r) => r.channel === channel),
      entities,
      cohort,
      rangeEnd: range.end,
      today: range.today,
      channel,
      level,
      paywallUsers,
    });
    return {
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      channel,
      level,
      levels: FUNNEL_LEVELS_BY_CHANNEL[channel],
      ...built,
      minSignUps: MIN_SIGNUPS_TO_JUDGE,
      lastSync: status.find((s) => s.channel === channel) ?? null,
      excludedUsers: excluded,
      definitions: FUNNEL_DEFINITIONS,
    };
  }
}
