/**
 * App Store Connect releases connector — READ-ONLY (docs/RELEASES_TRACKER_SPEC.md §5.1).
 * Reuses the campaigns ASC client/auth (ASC_KEY_ID / ASC_ISSUER_ID /
 * ASC_PRIVATE_KEY, app ASC_APP_ID). Only GET calls.
 *
 * Per sync: appStoreVersions (+ build, phased release), reviewSubmissions
 * (submittedDate), one en-US localization read per version (whatsNew), and
 * TestFlight builds (+ preReleaseVersion, buildBetaDetail, betaBuildLocalizations).
 * Plus Xcode Cloud: ciProducts (filter[app]) and one page of its buildRuns,
 * to record the exact commit each build was made from (Xcode Cloud stamps
 * build number = ciBuildRun number).
 * ≈ 15 requests/hour against Apple's 3,600/hour.
 */
import { ASC_BASE, AscClient, ascConfig } from '@/lib/campaigns/app-store';

import { ascVersionStatus, phasedFraction, releaseKey, supersedeOlderLive, testflightStatus, type ObservedRelease } from '../status';
import type { ReleaseCommit } from '../types';

import type { FetchLike, ReleaseConnector, StoreSnapshot } from './types';

type Json = Record<string, any>;

export const IOS_REPO = 'FitCircle-iOS';
/** An Xcode Cloud build is uploaded during its run; allow this much after finishedDate. */
const RUN_UPLOAD_SLACK_MS = 6 * 60 * 60 * 1000;

const MAX_PAGES = 5;

/** Apple dates carry an offset ("2026-10-26T14:54:56-07:00"); store as ISO UTC. */
export const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const includedMap = (included: Json[] | undefined) => {
  const m = new Map<string, Json>();
  for (const i of included ?? []) m.set(`${i.type}:${i.id}`, i);
  return m;
};
const rel = (d: Json, name: string): { type: string; id: string } | null => d?.relationships?.[name]?.data ?? null;

/** Latest submittedDate per appStoreVersion id. */
export function submittedDates(submissions: Json[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of submissions) {
    const vid = rel(s, 'appStoreVersionForReview')?.id;
    const at = isoOrNull(s.attributes?.submittedDate);
    if (!vid || !at) continue;
    const prev = out.get(vid);
    if (!prev || prev < at) out.set(vid, at);
  }
  return out;
}

/** appStoreVersions response (include=build,appStoreVersionPhasedRelease) → app_store releases. */
export function mapAscVersions(versions: { data: Json[]; included?: Json[] }, submitted: Map<string, string>, whatsNew: Map<string, string | null>): ObservedRelease[] {
  const inc = includedMap(versions.included);
  const out: ObservedRelease[] = [];
  for (const v of versions.data ?? []) {
    const a = v.attributes ?? {};
    if (a.platform && a.platform !== 'IOS') continue;
    const buildRef = rel(v, 'build');
    const build = buildRef ? inc.get(`builds:${buildRef.id}`) : null;
    const phasedRef = rel(v, 'appStoreVersionPhasedRelease');
    const phased = phasedRef ? inc.get(`appStoreVersionPhasedReleases:${phasedRef.id}`)?.attributes : null;
    const storeStatus: string | null = a.appVersionState ?? a.appStoreState ?? null;
    let status = ascVersionStatus(storeStatus);
    let rolloutFraction: number | null = status === 'live' ? 1 : null;
    if (status === 'live' && phased?.phasedReleaseState === 'ACTIVE') {
      status = 'rolling_out';
      rolloutFraction = phasedFraction(phased.currentDayNumber);
    } else if (status === 'live' && phased?.phasedReleaseState === 'PAUSED') {
      status = 'halted';
      rolloutFraction = phasedFraction(phased.currentDayNumber);
    }
    const version = String(a.versionString ?? '');
    if (!version) continue;
    const buildNumber = build?.attributes?.version != null ? String(build.attributes.version) : null;
    out.push({
      releaseKey: releaseKey({ platform: 'ios', track: 'app_store', version }),
      platform: 'ios',
      track: 'app_store',
      version,
      build: buildNumber,
      status,
      storeStatus,
      releaseType: a.releaseType === 'MANUAL' ? 'manual' : a.releaseType === 'AFTER_APPROVAL' ? 'auto' : a.releaseType === 'SCHEDULED' ? 'scheduled' : null,
      rolloutFraction,
      whatsNew: whatsNew.get(v.id) ?? null,
      sourceId: v.id,
      storeCreatedAt: isoOrNull(a.createdDate),
      uploadedAt: isoOrNull(build?.attributes?.uploadedDate),
      submittedAt: submitted.get(v.id) ?? null,
      raw: { appStoreState: a.appStoreState ?? null, appVersionState: a.appVersionState ?? null, releaseType: a.releaseType ?? null, earliestReleaseDate: a.earliestReleaseDate ?? null, buildId: buildRef?.id ?? null, phasedRelease: phased ?? null },
    });
  }
  return supersedeOlderLive(out);
}

/** builds response (include=preReleaseVersion,buildBetaDetail,betaBuildLocalizations) → testflight releases. */
export function mapAscBuilds(builds: { data: Json[]; included?: Json[] }): ObservedRelease[] {
  const inc = includedMap(builds.included);
  const out: ObservedRelease[] = [];
  for (const b of builds.data ?? []) {
    const a = b.attributes ?? {};
    const pre = rel(b, 'preReleaseVersion');
    const preAttrs = pre ? inc.get(`preReleaseVersions:${pre.id}`)?.attributes : null;
    if (preAttrs?.platform && preAttrs.platform !== 'IOS') continue;
    const version = preAttrs?.version ? String(preAttrs.version) : null;
    const buildNumber = a.version != null ? String(a.version) : null;
    if (!version || !buildNumber) continue;
    const detailRef = rel(b, 'buildBetaDetail');
    const detail = detailRef ? inc.get(`buildBetaDetails:${detailRef.id}`)?.attributes : null;
    const locRefs: Array<{ id: string }> = b.relationships?.betaBuildLocalizations?.data ?? [];
    const locs = locRefs.map((r) => inc.get(`betaBuildLocalizations:${r.id}`)?.attributes).filter(Boolean) as Json[];
    const loc = locs.find((l) => l.locale === 'en-US') ?? locs[0];
    const storeStatus = [a.processingState, detail?.internalBuildState, detail?.externalBuildState].filter(Boolean).join(' / ') || null;
    out.push({
      releaseKey: releaseKey({ platform: 'ios', track: 'testflight', version, build: buildNumber }),
      platform: 'ios',
      track: 'testflight',
      version,
      build: buildNumber,
      status: testflightStatus({ processingState: a.processingState, expired: a.expired, internalBuildState: detail?.internalBuildState, externalBuildState: detail?.externalBuildState }),
      storeStatus,
      whatsNew: typeof loc?.whatsNew === 'string' && loc.whatsNew.trim() ? loc.whatsNew : null,
      sourceId: b.id,
      uploadedAt: isoOrNull(a.uploadedDate),
      raw: { processingState: a.processingState ?? null, expired: a.expired ?? null, expirationDate: a.expirationDate ?? null, buildAudienceType: a.buildAudienceType ?? null, betaDetail: detail ?? null },
    });
  }
  // The same build number can be uploaded under two versions; keys differ, keep both.
  return out;
}

export interface CiRunCommit {
  number: string;
  runId: string;
  startedAt: string | null;
  finishedAt: string | null;
  commit: ReleaseCommit;
  webUrl: string | null;
}

/** ciBuildRuns response → SUCCEEDED runs with a source commit, by build number. */
export function mapCiBuildRuns(runs: { data?: Json[] }): Map<string, CiRunCommit[]> {
  const out = new Map<string, CiRunCommit[]>();
  for (const r of runs.data ?? []) {
    const a = r.attributes ?? {};
    const sc = a.sourceCommit ?? {};
    const sha = typeof sc.commitSha === 'string' ? sc.commitSha.trim().toLowerCase() : '';
    if (a.completionStatus !== 'SUCCEEDED' || a.number == null || !/^[0-9a-f]{40}$/.test(sha)) continue;
    const startedAt = isoOrNull(a.startedDate) ?? isoOrNull(a.createdDate);
    const message = typeof sc.message === 'string' ? sc.message : '';
    const webUrl = typeof sc.webUrl === 'string' && /^https?:\/\//.test(sc.webUrl) ? sc.webUrl : null;
    const run: CiRunCommit = {
      number: String(a.number),
      runId: String(r.id),
      startedAt,
      finishedAt: isoOrNull(a.finishedDate),
      commit: { sha, subject: message.split('\n')[0].trim().slice(0, 500), repo: IOS_REPO, date: startedAt ? startedAt.slice(0, 10) : null },
      webUrl,
    };
    out.set(run.number, [...(out.get(run.number) ?? []), run]);
  }
  return out;
}

/**
 * The run that produced this build: same number, and (when the build's upload
 * time is known) uploaded inside the run's window. The window check keeps a
 * locally uploaded build that reused a number from picking up a cloud commit.
 */
function runFor(r: ObservedRelease, runs: Map<string, CiRunCommit[]>): CiRunCommit | null {
  if (!r.build) return null;
  const candidates = runs.get(r.build) ?? [];
  const up = r.uploadedAt ? Date.parse(r.uploadedAt) : NaN;
  const fits = candidates.filter((c) => {
    if (!Number.isFinite(up)) return true;
    const start = c.startedAt ? Date.parse(c.startedAt) : NaN;
    const end = c.finishedAt ? Date.parse(c.finishedAt) : NaN;
    if (Number.isFinite(start) && up < start) return false;
    if (Number.isFinite(end) && up > end + RUN_UPLOAD_SLACK_MS) return false;
    return true;
  });
  return fits.length === 1 ? fits[0] : null;
}

/** Attach the Xcode Cloud commit (and its GitHub link) to iOS releases whose build came from a SUCCEEDED run. */
export function attachCiCommits(releases: ObservedRelease[], runs: Map<string, CiRunCommit[]>): ObservedRelease[] {
  return releases.map((r) => {
    if (r.platform !== 'ios') return r;
    const run = runFor(r, runs);
    if (!run) return r;
    return { ...r, commits: [run.commit], links: run.webUrl ? { ...(r.links ?? {}), xcode_cloud: run.webUrl } : r.links };
  });
}

export class AppStoreReleasesConnector implements ReleaseConnector {
  source = 'app_store_connect' as const;
  constructor(private readonly fetchImpl?: FetchLike) {}

  isConfigured(): boolean {
    return !!ascConfig();
  }

  private client(): AscClient {
    const cfg = ascConfig();
    if (!cfg) throw new Error('App Store Connect not configured');
    return new AscClient(cfg, (this.fetchImpl ?? fetch) as typeof fetch);
  }

  /** GET with links.next pagination; data + included concatenated. */
  private async all(client: AscClient, path: string): Promise<{ data: Json[]; included: Json[] }> {
    const data: Json[] = [];
    const included: Json[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const res: Json = await client.call('GET', next);
      data.push(...(res?.data ?? []));
      included.push(...(res?.included ?? []));
      const link: string | undefined = res?.links?.next;
      next = link ? link.replace(ASC_BASE, '') : null;
    }
    return { data, included };
  }

  async fetchSnapshot(): Promise<StoreSnapshot> {
    const client = this.client();
    const app = client.appId;
    const versions = await this.all(client, `/v1/apps/${app}/appStoreVersions?limit=200&include=build,appStoreVersionPhasedRelease&fields[builds]=version,uploadedDate,processingState`);
    const submissions = await this.all(client, `/v1/reviewSubmissions?filter[app]=${app}&limit=200&include=appStoreVersionForReview&fields[appStoreVersions]=versionString`);
    const whatsNew = new Map<string, string | null>();
    for (const v of versions.data) {
      if (v.attributes?.platform && v.attributes.platform !== 'IOS') continue;
      try {
        const loc: Json = await client.call('GET', `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=50&fields[appStoreVersionLocalizations]=locale,whatsNew`);
        const list: Json[] = loc?.data ?? [];
        const en = list.find((l) => l.attributes?.locale === 'en-US') ?? list[0];
        const text = en?.attributes?.whatsNew;
        whatsNew.set(v.id, typeof text === 'string' && text.trim() ? text : null);
      } catch (e) {
        // A missing localization must not fail the sync; planRelease keeps the stored text.
        console.warn('[releases/asc] localization read failed:', (e as Error)?.message);
      }
    }
    const builds = await this.all(
      client,
      `/v1/builds?filter[app]=${app}&limit=200&sort=-uploadedDate&include=preReleaseVersion,buildBetaDetail,betaBuildLocalizations&fields[preReleaseVersions]=version,platform`
    );
    const releases = [...mapAscVersions(versions, submittedDates(submissions.data), whatsNew), ...mapAscBuilds(builds)];
    return { releases: attachCiCommits(releases, await this.ciRuns(client)), completeTracks: [] };
  }

  /** Xcode Cloud runs by build number. A failure here never fails the store sync. */
  private async ciRuns(client: AscClient): Promise<Map<string, CiRunCommit[]>> {
    try {
      const products: Json = await client.call('GET', `/v1/ciProducts?filter[app]=${client.appId}&limit=10`);
      const product = (products?.data ?? []).find((p: Json) => p.attributes?.productType !== 'FRAMEWORK') ?? products?.data?.[0];
      if (!product?.id) return new Map();
      const runs: Json = await client.call(
        'GET',
        `/v1/ciProducts/${product.id}/buildRuns?sort=-number&limit=200&fields[ciBuildRuns]=number,createdDate,startedDate,finishedDate,sourceCommit,completionStatus`
      );
      return mapCiBuildRuns(runs ?? {});
    } catch (e) {
      console.warn('[releases/asc] Xcode Cloud runs read failed:', (e as Error)?.message);
      return new Map();
    }
  }
}
