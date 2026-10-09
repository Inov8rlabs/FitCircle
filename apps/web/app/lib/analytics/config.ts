/**
 * Build-time analytics configuration.
 *
 * Every NEXT_PUBLIC_* variable is referenced by its literal name so Next.js can
 * inline it into the client bundle. Nothing here touches `window`.
 */
import type { AnalyticsGlobalProperties } from './types';

/** Client API keys are publishable (README: never ship a secret key in a client). */
/** "FitCircle" project 746168: production web + store builds. */
const AMPLITUDE_PRODUCTION_KEY = 'd0229f4c11c291cb0cb2204620bc9657';
/** "FitCircle Dev" project 875589: previews, local dev, QA builds. */
const AMPLITUDE_DEV_KEY = 'e03771b97db31e206aa90890ad502122';

export interface AnalyticsConfig {
  isProduction: boolean;
  amplitudeApiKey: string | null;
  replaySampleRate: number;
  posthogKey: string | null;
  posthogHost: string;
  consoleEnabled: boolean;
  globals: AnalyticsGlobalProperties;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseRate(value: string | undefined): number {
  const rate = Number.parseFloat(value ?? '');
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(rate, 1);
}

export function readAnalyticsConfig(): AnalyticsConfig {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV;
  const isProduction = vercelEnv === 'production';

  // Production web → FitCircle project; preview / local → FitCircle Dev project.
  // An explicit env var wins in each case. Setting it to "off" disables Amplitude.
  const amplitudeOverride = isProduction
    ? clean(process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY)
    : clean(process.env.NEXT_PUBLIC_AMPLITUDE_DEV_API_KEY);
  const amplitudeApiKey =
    amplitudeOverride === 'off'
      ? null
      : amplitudeOverride ?? (isProduction ? AMPLITUDE_PRODUCTION_KEY : AMPLITUDE_DEV_KEY);

  const commit = clean(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA);
  const appBuild =
    (commit ? commit.slice(0, 7) : null) ??
    clean(process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID) ??
    'local';

  return {
    isProduction,
    amplitudeApiKey,
    replaySampleRate: parseRate(process.env.NEXT_PUBLIC_AMPLITUDE_REPLAY_SAMPLE_RATE),
    posthogKey: clean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    posthogHost: clean(process.env.NEXT_PUBLIC_POSTHOG_HOST) ?? 'https://us.i.posthog.com',
    consoleEnabled: process.env.NODE_ENV === 'development',
    globals: {
      platform_app: 'web',
      environment: isProduction ? 'production' : 'development',
      app_build: appBuild,
    },
  };
}
