/**
 * Client context for assignment, read from the same headers the home feed uses
 * (X-App-Platform / X-Platform, X-App-Version, X-App-Build) plus Vercel's geo header.
 * Missing or unparseable values are null — and null never passes an audience gate.
 */
import type { ClientPlatform } from './model';

type HeaderSource = { headers: { get(name: string): string | null } };

export interface ExperimentRequestInfo {
  platform: ClientPlatform | null;
  appVersion: string | null;
  /**
   * X-App-Build as a positive integer (iOS CFBundleVersion, Android versionCode).
   * A leading integer is kept ("63 (debug)" → 63); anything else → null.
   */
  appBuild: number | null;
  /** ISO alpha-2 from Vercel's edge (x-vercel-ip-country), upper-case. */
  ipCountry: string | null;
}

export function parseClientPlatform(raw: string | null | undefined): ClientPlatform | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'ios' || v === 'android' || v === 'web' ? v : null;
}

export function parseAppBuild(raw: string | null | undefined): number | null {
  const m = /^\s*(\d{1,9})(?![\d.])/.exec(raw ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

export function readExperimentRequestInfo(request: HeaderSource): ExperimentRequestInfo {
  const h = request.headers;
  const country = (h.get('x-vercel-ip-country') ?? '').trim().toUpperCase();
  return {
    platform: parseClientPlatform(h.get('x-app-platform') ?? h.get('x-platform')),
    appVersion: (h.get('x-app-version') ?? '').trim().slice(0, 32) || null,
    appBuild: parseAppBuild(h.get('x-app-build')),
    ipCountry: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}
