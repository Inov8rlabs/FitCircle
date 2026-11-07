import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { PlayIntegrityClient, evaluateVerdict, normalizeCertDigest, playIntegrityConfigFromEnv, type IntegrityPayload } from '../play-integrity';

const PKG = 'com.inov8rlabs.apps.fitcircle';
const CERT_COLON_HEX = '79:98:1B:82:56:AB:DF:8D:00:6F:59:FC:FC:12:36:8D:6F:4C:B7:D9:5B:22:55:2D:91:08:CB:6D:7D:89:54:8D';
const CERT_B64URL = 'eZgbglar340Ab1n8_BI2jW9Mt9lbIlUtkQjLbX2JVI0';
const HASH = 'c6c10179f22e1dda3fa94fa693d712486c7d3117d5bf1aee55a20da8c7ccd590';
const NOW = 1_800_000_000_000;

/** Fixture verdicts, shaped like decodeIntegrityToken's tokenPayloadExternal. */
function verdict(overrides: { request?: Record<string, unknown>; app?: Record<string, unknown>; device?: string[]; licensing?: string } = {}): IntegrityPayload {
  return {
    requestDetails: { requestPackageName: PKG, requestHash: HASH, timestampMillis: String(NOW - 5_000), ...(overrides.request ?? {}) },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PKG, certificateSha256Digest: [CERT_B64URL], versionCode: '61', ...(overrides.app ?? {}) },
    deviceIntegrity: { deviceRecognitionVerdict: overrides.device ?? ['MEETS_DEVICE_INTEGRITY'] },
    accountDetails: { appLicensingVerdict: overrides.licensing ?? 'LICENSED' },
  };
}

const FIXTURES: Record<string, IntegrityPayload> = {
  pass: verdict(),
  passStrong: verdict({ device: ['MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY'] }),
  sideloaded: verdict({ app: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' }, licensing: 'UNLICENSED' }),
  repackaged: verdict({ app: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', certificateSha256Digest: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'] } }),
  unevaluated: { ...verdict(), appIntegrity: { appRecognitionVerdict: 'UNEVALUATED' } },
  emulator: verdict({ device: [] }),
  rootedBasicOnly: verdict({ device: ['MEETS_BASIC_INTEGRITY'] }),
  unlicensed: verdict({ licensing: 'UNLICENSED' }),
  licensingUnevaluated: verdict({ licensing: 'UNEVALUATED' }),
  stale: verdict({ request: { timestampMillis: String(NOW - 3 * 60_000) } }),
  replayedHash: verdict({ request: { requestHash: 'f'.repeat(64) } }),
  otherPackage: verdict({ request: { requestPackageName: 'com.example.clone' } }),
  wrongCert: verdict({ app: { certificateSha256Digest: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'] } }),
};

const expected = { requestHash: HASH, packageName: PKG, certDigests: [normalizeCertDigest(CERT_COLON_HEX)!], nowMs: NOW };

describe('evaluateVerdict (fixture verdicts)', () => {
  it.each([
    ['pass', null],
    ['passStrong', null],
    ['sideloaded', 'app_not_recognized'],
    ['repackaged', 'app_not_recognized'],
    ['unevaluated', 'app_not_recognized'],
    ['emulator', 'device_integrity'],
    ['rootedBasicOnly', 'device_integrity'],
    ['unlicensed', 'unlicensed'],
    ['licensingUnevaluated', 'unlicensed'],
    ['stale', 'stale_token'],
    ['replayedHash', 'request_hash_mismatch'],
    ['otherPackage', 'package_mismatch'],
    ['wrongCert', 'cert_mismatch'],
  ])('%s → %s', (name, reason) => {
    const r = evaluateVerdict(FIXTURES[name], expected);
    if (reason === null) expect(r.pass).toBe(true);
    else expect(r).toMatchObject({ pass: false, reason });
  });

  it('summary carries verdict fields, never the token', () => {
    const r = evaluateVerdict(FIXTURES.emulator, expected);
    expect(r.summary).toEqual({ appRecognition: 'PLAY_RECOGNIZED', deviceRecognition: [], licensing: 'LICENSED', versionCode: '61', tokenAgeMs: 5_000 });
  });

  it('no configured cert digests never passes', () => {
    expect(evaluateVerdict(FIXTURES.pass, { ...expected, certDigests: [] })).toMatchObject({ pass: false, reason: 'cert_mismatch' });
  });

  it('a token from the future beyond skew is stale', () => {
    expect(evaluateVerdict(verdict({ request: { timestampMillis: String(NOW + 60_000) } }), expected)).toMatchObject({ pass: false, reason: 'stale_token' });
  });
});

describe('certificate digests', () => {
  it('colon-hex (Play Console) and base64url (verdict) are the same bytes', () => {
    expect(normalizeCertDigest(CERT_COLON_HEX)).toBe(normalizeCertDigest(CERT_B64URL));
    expect(normalizeCertDigest(CERT_COLON_HEX.replace(/:/g, '').toLowerCase())).toBe(normalizeCertDigest(CERT_B64URL));
    expect(normalizeCertDigest(CERT_B64URL)).toBe('79981b8256abdf8d006f59fcfc12368d6f4cb7d95b22552d9108cb6d7d89548d');
  });

  it('env accepts a comma list in any form', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const key = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    const cfg = playIntegrityConfigFromEnv({ PLAY_INTEGRITY_SA_JSON: Buffer.from(key).toString('base64'), PLAY_INTEGRITY_CERT_SHA256: `${CERT_COLON_HEX}, ${CERT_B64URL}, junk` } as any);
    expect(cfg?.packageName).toBe(PKG);
    expect(cfg?.certDigests).toEqual(['79981b8256abdf8d006f59fcfc12368d6f4cb7d95b22552d9108cb6d7d89548d', '79981b8256abdf8d006f59fcfc12368d6f4cb7d95b22552d9108cb6d7d89548d']);
    expect(playIntegrityConfigFromEnv({} as any)).toBeNull();
  });
});

describe('PlayIntegrityClient.decode: client vs infrastructure errors', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const config = { key: { client_email: 'sa@x', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }, packageName: PKG, certDigests: [] };
  const tokenOk = () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });

  it('decoded payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(JSON.stringify({ tokenPayloadExternal: FIXTURES.pass }), { status: 200 }));
    const r = await new PlayIntegrityClient(config, fetchImpl as any).decode('tok');
    expect(r).toEqual({ kind: 'decoded', payload: FIXTURES.pass });
    expect(fetchImpl.mock.calls[1][0]).toBe(`https://playintegrity.googleapis.com/v1/${PKG}:decodeIntegrityToken`);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ integrityToken: 'tok' });
  });

  it('400 (token Google rejects) is a client error → caller blocks', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }), { status: 400 }));
    expect((await new PlayIntegrityClient(config, fetchImpl as any).decode('garbage')).kind).toBe('client');
  });

  it.each([403, 429, 500, 503])('%s is infrastructure → caller fails open', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(new Response('{}', { status }));
    expect((await new PlayIntegrityClient(config, fetchImpl as any).decode('t')).kind).toBe('infra');
  });

  it('OAuth failure, network error and missing config are infrastructure', async () => {
    expect((await new PlayIntegrityClient(config, vi.fn().mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 })) as any).decode('t')).kind).toBe('infra');
    expect((await new PlayIntegrityClient(config, vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any).decode('t')).kind).toBe('infra');
    expect((await new PlayIntegrityClient(null).decode('t')).kind).toBe('infra');
  });

  it('caches the OAuth token', async () => {
    const decodeOk = () => new Response(JSON.stringify({ tokenPayloadExternal: FIXTURES.pass }), { status: 200 });
    const fetchImpl = vi.fn().mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(decodeOk()).mockResolvedValueOnce(decodeOk());
    const client = new PlayIntegrityClient(config, fetchImpl as any);
    await client.decode('a');
    await client.decode('b');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
