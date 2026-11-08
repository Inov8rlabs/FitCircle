/**
 * Fallback matcher: GA4 app instance ↔ FitCircle user when there is no GA4
 * user_id and no stored app_instance_id (every user on Android ≤ 1.1.2, and
 * every past user). docs/ADS_ATTRIBUTION_GA4.md §8. Pure.
 *
 * A pair (instance, user) is compatible when
 *   - time:    the user's first-seen time is MIN_DELTA_S … MAX_DELTA_S after the
 *              instance's first open (install → onboarding → sign-up),
 *   - country: no conflict (GA4 geo.country vs any of our ISO2 signals), and
 *   - device:  no conflict (GA4 hardware model / model name vs our Android
 *              push-token device names),
 *   - and at least one of country / device positively agrees.
 * Only pairs that are unique in BOTH directions are accepted (one compatible
 * user for the instance, one compatible instance for the user). Every
 * compatible pair counts toward ambiguity, including low-confidence ones and
 * test users, so a near-simultaneous second install or QA account makes the
 * match ambiguous instead of guessing.
 */

/** Sign-up may precede GA4's client clock by a little (client clock skew). */
export const MIN_DELTA_S = -120;
/** Install → sign-up. Observed 51–77 s for a direct sign-up; 45 min covers a slow onboarding. */
export const MAX_DELTA_S = 45 * 60;
/** "high" needs device + country agreement within this many seconds. */
export const HIGH_DELTA_S = 15 * 60;

export type Confidence = 'exact' | 'high' | 'medium' | 'low';
export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3, exact: 4 };
export const parseConfidence = (v: unknown, fallback: Confidence = 'medium'): Confidence =>
  v === 'low' || v === 'medium' || v === 'high' || v === 'exact' ? v : fallback;

export type Agreement = 'match' | 'unknown' | 'mismatch';

export interface MatchInstance {
  pseudoId: string;
  /** First open (else first touch / first event), epoch ms. */
  firstOpenMs: number | null;
  countryIso: string | null;
  countryName: string | null;
  region: string | null;
  /** Raw GA4 device strings (hardware model, model name, marketing name). */
  devices: string[];
  brand: string | null;
}

export interface MatchUser {
  userId: string;
  /** Earliest of profile created_at / attribution reported_at / push token / experiment assignment, epoch ms. */
  firstSeenMs: number | null;
  countries: Array<{ source: string; value: string }>;
  /** Android push-token device names ("samsung SM-S916U1"). */
  devices: string[];
  isTest: boolean;
}

export interface PairEvidence {
  deltaSeconds: number;
  country: Agreement;
  device: Agreement;
  ga4Country: string | null;
  ga4CountryName: string | null;
  ga4Region: string | null;
  ga4Devices: string[];
  userCountries: Array<{ source: string; value: string }>;
  userDevices: string[];
  fieldsUsed: string[];
}

export interface HeuristicMatch {
  pseudoId: string;
  userId: string;
  confidence: Exclude<Confidence, 'exact'>;
  evidence: PairEvidence;
}

export interface Unmatched {
  pseudoId: string;
  reason: 'no_candidate' | 'ambiguous_instance' | 'ambiguous_user' | 'no_first_open';
  candidates: Array<{ userId: string; deltaSeconds: number; country: Agreement; device: Agreement }>;
}

/**
 * Device string → comparable keys (alnum-only, lower case). Our push-token
 * names are `<manufacturer> <model>`, so `withoutFirstWord` also yields the
 * bare model; GA4 strings are compared whole.
 */
export function deviceKeys(name: string | null | undefined, withoutFirstWord = false): string[] {
  const s = String(name ?? '').trim();
  if (!s || s === '(not set)') return [];
  const k = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = new Set<string>();
  const full = k(s);
  if (full.length >= 3) out.add(full);
  const words = s.split(/\s+/);
  if (withoutFirstWord && words.length > 1) {
    const rest = k(words.slice(1).join(' '));
    if (rest.length >= 3) out.add(rest);
  }
  return [...out];
}

export function deviceAgreement(ga4: readonly string[], ours: readonly string[]): Agreement {
  const a = new Set(ga4.flatMap((d) => deviceKeys(d)));
  const b = ours.flatMap((d) => deviceKeys(d, true));
  if (!a.size || !b.length) return 'unknown';
  return b.some((x) => a.has(x)) ? 'match' : 'mismatch';
}

export function countryAgreement(ga4Iso: string | null, ours: ReadonlyArray<{ source?: string; value: string }>): Agreement {
  if (!ga4Iso || !ours.length) return 'unknown';
  return ours.some((c) => c.value === ga4Iso) ? 'match' : 'mismatch';
}

/** Null = incompatible. */
export function scorePair(i: MatchInstance, u: MatchUser): { confidence: HeuristicMatch['confidence']; evidence: PairEvidence } | null {
  if (i.firstOpenMs === null || u.firstSeenMs === null) return null;
  const deltaSeconds = Math.round((u.firstSeenMs - i.firstOpenMs) / 1000);
  if (deltaSeconds < MIN_DELTA_S || deltaSeconds > MAX_DELTA_S) return null;
  const country = countryAgreement(i.countryIso, u.countries);
  const device = deviceAgreement(i.devices, u.devices);
  if (country === 'mismatch' || device === 'mismatch') return null;
  if (country === 'unknown' && device === 'unknown') return null;
  const confidence: HeuristicMatch['confidence'] =
    device === 'match' && country === 'match' && Math.abs(deltaSeconds) <= HIGH_DELTA_S ? 'high' : device === 'match' ? 'medium' : 'low';
  const fieldsUsed = ['time'];
  if (country === 'match') fieldsUsed.push('country');
  if (device === 'match') fieldsUsed.push('device');
  return {
    confidence,
    evidence: {
      deltaSeconds,
      country,
      device,
      ga4Country: i.countryIso,
      ga4CountryName: i.countryName,
      ga4Region: i.region,
      ga4Devices: i.devices,
      userCountries: u.countries,
      userDevices: u.devices,
      fieldsUsed,
    },
  };
}

/** 1:1 unique matches between instances and users; everything else reported as unmatched. */
export function matchInstances(instances: readonly MatchInstance[], users: readonly MatchUser[]): { matches: HeuristicMatch[]; unmatched: Unmatched[] } {
  type Pair = { i: MatchInstance; u: MatchUser; s: NonNullable<ReturnType<typeof scorePair>> };
  const pairs: Pair[] = [];
  const byInstance = new Map<string, Pair[]>();
  const byUser = new Map<string, Pair[]>();
  // Volumes are hundreds per window, so O(instances × users) is fine.
  for (const i of instances) {
    for (const u of users) {
      const s = scorePair(i, u);
      if (!s) continue;
      const p = { i, u, s };
      pairs.push(p);
      (byInstance.get(i.pseudoId) ?? byInstance.set(i.pseudoId, []).get(i.pseudoId)!).push(p);
      (byUser.get(u.userId) ?? byUser.set(u.userId, []).get(u.userId)!).push(p);
    }
  }
  const matches: HeuristicMatch[] = [];
  const unmatched: Unmatched[] = [];
  const cand = (ps: Pair[]) => ps.map((p) => ({ userId: p.u.userId, deltaSeconds: p.s.evidence.deltaSeconds, country: p.s.evidence.country, device: p.s.evidence.device }));
  for (const i of instances) {
    const ps = byInstance.get(i.pseudoId) ?? [];
    if (i.firstOpenMs === null) {
      unmatched.push({ pseudoId: i.pseudoId, reason: 'no_first_open', candidates: [] });
    } else if (!ps.length) {
      unmatched.push({ pseudoId: i.pseudoId, reason: 'no_candidate', candidates: [] });
    } else if (ps.length > 1) {
      unmatched.push({ pseudoId: i.pseudoId, reason: 'ambiguous_instance', candidates: cand(ps) });
    } else {
      const p = ps[0];
      const userPairs = byUser.get(p.u.userId)!;
      if (userPairs.length > 1) unmatched.push({ pseudoId: i.pseudoId, reason: 'ambiguous_user', candidates: cand(userPairs) });
      else matches.push({ pseudoId: i.pseudoId, userId: p.u.userId, confidence: p.s.confidence, evidence: p.s.evidence });
    }
  }
  return { matches, unmatched };
}
