/**
 * Short-lived server nonces for the integrity request hash (docs/INTEGRITY_CONTRACT.md).
 *
 * Issuing needs no storage: a nonce is 16 random bytes + expiry + an HMAC over both and
 * the device id, base64url (54 chars). Consuming checks the HMAC, the expiry and the
 * device, then records the nonce in public.integrity_nonces (primary key) together with
 * the request it was used for.
 *
 * Single use per request: a second use for a DIFFERENT request (path or body) is a
 * replay. The SAME request (same device, path and body hash) may present the nonce
 * again within its TTL, because HTTP clients retry a request transparently on a
 * dropped connection; that retry carries the same token and the same request hash.
 *
 * A storage failure while consuming is `error` (the caller fails open).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { createAdminSupabase } from '@/lib/supabase-admin';

export const NONCE_TTL_MS = 2 * 60_000;
const RAND_BYTES = 16;
const EXP_BYTES = 8;
const SIG_BYTES = 16;
const TOTAL = RAND_BYTES + EXP_BYTES + SIG_BYTES;

export interface IssuedNonce {
  nonce: string;
  expiresAt: string;
}

export type ConsumeResult = 'ok' | 'malformed' | 'bad_signature' | 'expired' | 'replayed' | 'error';

/** Nonces can be issued (a signing secret is configured). */
export function nonceIssuanceConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.INTEGRITY_NONCE_SECRET || env.JWT_SECRET);
}

function secret(): string {
  const s = process.env.INTEGRITY_NONCE_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error('INTEGRITY_NONCE_SECRET (or JWT_SECRET) is not configured');
  return s;
}

function sign(rand: Buffer, exp: Buffer, deviceId: string): Buffer {
  return createHmac('sha256', `integrity-nonce:${secret()}`).update(rand).update(exp).update(deviceId, 'utf8').digest().subarray(0, SIG_BYTES);
}

export function issueNonce(deviceId: string, now = Date.now()): IssuedNonce {
  const rand = randomBytes(RAND_BYTES);
  const expMs = now + NONCE_TTL_MS;
  const exp = Buffer.alloc(EXP_BYTES);
  exp.writeBigUInt64BE(BigInt(expMs));
  const nonce = Buffer.concat([rand, exp, sign(rand, exp, deviceId)]).toString('base64url');
  return { nonce, expiresAt: new Date(expMs).toISOString() };
}

/** Signature + expiry + device binding, no storage. */
export function verifyNonce(
  nonce: string,
  deviceId: string,
  now = Date.now()
): { ok: true; expiresAt: number } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' } {
  const raw = Buffer.from(nonce, 'base64url');
  if (raw.length !== TOTAL || raw.toString('base64url') !== nonce) return { ok: false, reason: 'malformed' };
  const rand = raw.subarray(0, RAND_BYTES);
  const exp = raw.subarray(RAND_BYTES, RAND_BYTES + EXP_BYTES);
  const sig = raw.subarray(RAND_BYTES + EXP_BYTES);
  if (!timingSafeEqual(sig, sign(rand, exp, deviceId))) return { ok: false, reason: 'bad_signature' };
  const expiresAt = Number(exp.readBigUInt64BE());
  if (expiresAt < now) return { ok: false, reason: 'expired' };
  return { ok: true, expiresAt };
}

export interface NonceUse {
  path: string;
  bodySha256: string;
}

/** Use a nonce for one request (see the module comment for same-request retries). */
export async function consumeNonce(nonce: string, deviceId: string, use: NonceUse, now = Date.now()): Promise<ConsumeResult> {
  const v = verifyNonce(nonce, deviceId, now);
  if (!v.ok) return v.reason;
  try {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from('integrity_nonces').insert({
      nonce,
      device_id: deviceId,
      request_path: use.path,
      body_sha256: use.bodySha256,
      expires_at: new Date(v.expiresAt).toISOString(),
    });
    if (error) {
      if (error.code !== '23505') {
        console.error('[integrity] nonce record failed:', error.message);
        return 'error';
      }
      const { data: prior, error: readError } = await supabase
        .from('integrity_nonces')
        .select('device_id, request_path, body_sha256')
        .eq('nonce', nonce)
        .maybeSingle();
      if (readError) {
        console.error('[integrity] nonce lookup failed:', readError.message);
        return 'error';
      }
      const same = prior && prior.device_id === deviceId && prior.request_path === use.path && prior.body_sha256 === use.bodySha256;
      return same ? 'ok' : 'replayed';
    }
    if (Math.random() < 0.05) {
      // Opportunistic cleanup: an expired nonce is rejected by its own expiry, so its row is not needed.
      void supabase
        .from('integrity_nonces')
        .delete()
        .lt('expires_at', new Date(now - 60_000).toISOString())
        .then(({ error: e }: { error: { message: string } | null }) => {
          if (e) console.warn('[integrity] nonce cleanup failed:', e.message);
        });
    }
    return 'ok';
  } catch (err: any) {
    console.error('[integrity] nonce record threw:', err?.message ?? err);
    return 'error';
  }
}
