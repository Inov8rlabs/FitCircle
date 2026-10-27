import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { mapAscBuilds, mapAscVersions, submittedDates } from '../connectors/app-store';
import { GooglePlayReleasesConnector, mapPlayTracks, playCredentialsFromEnv } from '../connectors/google-play';

const VERSIONS = {
  data: [
    { type: 'appStoreVersions', id: 'v109', attributes: { platform: 'IOS', versionString: '1.0.9', appStoreState: 'READY_FOR_SALE', appVersionState: 'READY_FOR_DISTRIBUTION', releaseType: 'MANUAL', createdDate: '2026-10-26T14:54:56-07:00' }, relationships: { build: { data: { type: 'builds', id: 'b71' } }, appStoreVersionPhasedRelease: { data: null } } },
    { type: 'appStoreVersions', id: 'v108', attributes: { platform: 'IOS', versionString: '1.0.8', appStoreState: 'READY_FOR_SALE', appVersionState: 'READY_FOR_DISTRIBUTION', releaseType: 'MANUAL', createdDate: '2026-10-23T06:37:25-07:00' }, relationships: { build: { data: { type: 'builds', id: 'b70' } } } },
    { type: 'appStoreVersions', id: 'v110', attributes: { platform: 'IOS', versionString: '1.1.0', appVersionState: 'WAITING_FOR_REVIEW', releaseType: 'AFTER_APPROVAL', createdDate: '2026-10-27T09:00:00-07:00' }, relationships: { build: { data: { type: 'builds', id: 'b72' } }, appStoreVersionPhasedRelease: { data: { type: 'appStoreVersionPhasedReleases', id: 'p1' } } } },
  ],
  included: [
    { type: 'builds', id: 'b71', attributes: { version: '71', uploadedDate: '2026-10-26T14:09:57-07:00' } },
    { type: 'builds', id: 'b70', attributes: { version: '70', uploadedDate: '2026-10-23T07:17:16-07:00' } },
    { type: 'builds', id: 'b72', attributes: { version: '72', uploadedDate: '2026-10-26T15:34:41-07:00' } },
    { type: 'appStoreVersionPhasedReleases', id: 'p1', attributes: { phasedReleaseState: 'INACTIVE' } },
  ],
};
const SUBMISSIONS = [
  { attributes: { submittedDate: '2026-10-23T13:38:51.08Z' }, relationships: { appStoreVersionForReview: { data: { id: 'v108' } } } },
  { attributes: { submittedDate: '2026-10-23T14:21:15.927Z' }, relationships: { appStoreVersionForReview: { data: { id: 'v108' } } } },
  { attributes: { submittedDate: null }, relationships: { appStoreVersionForReview: { data: { id: 'v109' } } } },
];

describe('App Store Connect mapping', () => {
  it('maps versions: newest READY_FOR_SALE live, older superseded, builds + dates + whatsNew', () => {
    const out = mapAscVersions(VERSIONS, submittedDates(SUBMISSIONS), new Map([['v109', 'Fewer, smarter notifications']]));
    const by = Object.fromEntries(out.map((r) => [r.version, r]));
    expect(by['1.0.9']).toMatchObject({ releaseKey: 'ios:app_store:1.0.9', build: '71', status: 'live', rolloutFraction: 1, releaseType: 'manual', whatsNew: 'Fewer, smarter notifications', storeCreatedAt: '2026-10-26T21:54:56.000Z', uploadedAt: '2026-10-26T21:09:57.000Z', submittedAt: null });
    expect(by['1.0.8']).toMatchObject({ status: 'superseded', storeStatus: 'READY_FOR_DISTRIBUTION', submittedAt: '2026-10-23T14:21:15.927Z' });
    expect(by['1.1.0']).toMatchObject({ status: 'waiting_for_review', releaseType: 'auto', build: '72' });
  });

  it('maps an active phased release to rolling_out with Apple’s day fraction', () => {
    const v = structuredClone(VERSIONS);
    v.data = [v.data[0]];
    v.data[0].relationships.appStoreVersionPhasedRelease = { data: { type: 'appStoreVersionPhasedReleases', id: 'p9' } } as any;
    v.included.push({ type: 'appStoreVersionPhasedReleases', id: 'p9', attributes: { phasedReleaseState: 'ACTIVE', currentDayNumber: 3 } } as any);
    expect(mapAscVersions(v, new Map(), new Map())[0]).toMatchObject({ status: 'rolling_out', rolloutFraction: 0.05 });
  });

  it('maps TestFlight builds with version, beta state and en-US notes', () => {
    const out = mapAscBuilds({
      data: [
        { id: 'b72', attributes: { version: '72', uploadedDate: '2026-10-26T15:34:41-07:00', processingState: 'VALID', expired: false }, relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'pre110' } }, buildBetaDetail: { data: { type: 'buildBetaDetails', id: 'b72' } }, betaBuildLocalizations: { data: [{ type: 'betaBuildLocalizations', id: 'l1' }] } } },
        { id: 'b40', attributes: { version: '40', processingState: 'VALID', expired: true }, relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'pre101' } } } },
      ],
      included: [
        { type: 'preReleaseVersions', id: 'pre110', attributes: { version: '1.1.0', platform: 'IOS' } },
        { type: 'preReleaseVersions', id: 'pre101', attributes: { version: '1.0.1', platform: 'IOS' } },
        { type: 'buildBetaDetails', id: 'b72', attributes: { internalBuildState: 'IN_BETA_TESTING', externalBuildState: 'READY_FOR_BETA_SUBMISSION' } },
        { type: 'betaBuildLocalizations', id: 'l1', attributes: { locale: 'en-US', whatsNew: 'Activation journey' } },
      ],
    });
    expect(out[0]).toMatchObject({ releaseKey: 'ios:testflight:1.1.0(72)', status: 'in_testing', whatsNew: 'Activation journey', storeStatus: 'VALID / IN_BETA_TESTING / READY_FOR_BETA_SUBMISSION' });
    expect(out[1]).toMatchObject({ releaseKey: 'ios:testflight:1.0.1(40)', status: 'expired' });
  });
});

const TRACKS = {
  tracks: [
    {
      track: 'production',
      releases: [
        { name: '36 (1.0.9)', versionCodes: ['36'], status: 'completed', releaseNotes: [{ language: 'en-US', text: 'Fewer notifications' }], countryTargeting: { countries: ['US', 'CA'] } },
        { name: '37 (1.1.0)', versionCodes: ['37'], status: 'inProgress', userFraction: 0.2 },
      ],
    },
    { track: 'internal', releases: [{ name: '1.1.0', versionCodes: ['37'], status: 'completed' }] },
    { track: 'beta', releases: [{ name: 'draft', status: 'draft' }] },
  ],
};

describe('Google Play mapping', () => {
  it('maps track releases', () => {
    const snap = mapPlayTracks(TRACKS);
    expect(snap.completeTracks).toEqual(['android:play_production', 'android:play_internal', 'android:play_beta']);
    expect(snap.releases).toHaveLength(3);
    expect(snap.releases[0]).toMatchObject({ releaseKey: 'android:play_production:36', version: '1.0.9', status: 'live', rolloutFraction: 1, countries: ['US', 'CA'], whatsNew: 'Fewer notifications' });
    expect(snap.releases[1]).toMatchObject({ releaseKey: 'android:play_production:37', status: 'rolling_out', rolloutFraction: 0.2 });
    expect(snap.releases[2]).toMatchObject({ releaseKey: 'android:play_internal:37', status: 'in_testing' });
  });

  it('is not configured without GOOGLE_PLAY_SA_KEY', () => {
    expect(playCredentialsFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(new GooglePlayReleasesConnector(null).isConfigured()).toBe(false);
  });

  it('reads tracks inside an edit that is deleted, never committed', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { client_email: 'release-tracker@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('oauth2')) return Response.json({ access_token: 'tok' });
      if (init?.method === 'POST') return Response.json({ id: 'e1' });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json(TRACKS);
    });
    const c = new GooglePlayReleasesConnector({ key, packageName: 'com.inov8rlabs.apps.fitcircle' }, fetchMock as any);
    const snap = await c.fetchSnapshot();
    expect(snap.releases).toHaveLength(3);
    expect(calls.slice(1)).toEqual([
      'POST https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.inov8rlabs.apps.fitcircle/edits',
      'GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.inov8rlabs.apps.fitcircle/edits/e1/tracks',
      'DELETE https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.inov8rlabs.apps.fitcircle/edits/e1',
    ]);
    expect(calls.some((c) => c.includes(':commit'))).toBe(false);
  });

  it('still deletes the edit when reading tracks fails, and surfaces the error', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { client_email: 'a@b.c', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    const methods: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      if (url.includes('oauth2')) return Response.json({ access_token: 'tok' });
      if (init?.method === 'POST') return Response.json({ id: 'e1' });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ error: { message: 'The caller does not have permission' } }, { status: 403 });
    });
    await expect(new GooglePlayReleasesConnector({ key, packageName: 'p' }, fetchMock as any).fetchSnapshot()).rejects.toThrow(/does not have permission/);
    expect(methods).toContain('DELETE');
  });
});
