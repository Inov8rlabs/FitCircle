import type { AdChannel } from '../types';

import { AppleAdsConnector } from './apple-ads';
import { GoogleAdsConnector } from './google-ads';
import { MetaAdsConnector } from './meta';
import type { AdsConnector } from './types';

let override: Partial<Record<AdChannel, AdsConnector>> | null = null;

/** Tests: replace connectors (pass null to restore). */
export function setConnectorsForTest(map: Partial<Record<AdChannel, AdsConnector>> | null) {
  override = map;
}

/** All built connectors (Google Ads is read-only — spec §2). */
export function allConnectors(): AdsConnector[] {
  if (override) return Object.values(override).filter(Boolean);
  return [new AppleAdsConnector(), new MetaAdsConnector(), new GoogleAdsConnector()];
}

export function getConnector(channel: AdChannel): AdsConnector | null {
  if (override) return override[channel] ?? null;
  if (channel === 'apple_ads') return new AppleAdsConnector();
  if (channel === 'meta') return new MetaAdsConnector();
  if (channel === 'google_ads') return new GoogleAdsConnector();
  return null;
}

export type { AdsConnector } from './types';
