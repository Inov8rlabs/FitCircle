/**
 * Device attestations: a session (access-token `sid`) whose device passed the integrity
 * check. Later protected calls on the same session + device accept a live row instead of
 * a new token, so no per-request Google call is needed.
 */
import { createAdminSupabase } from '@/lib/supabase-admin';

import type { VerdictSummary } from './play-integrity';

export const ATTESTATION_TTL_MS = 24 * 60 * 60_000;
/** A session allowed during a verification outage is trusted for a shorter time. */
export const FAIL_OPEN_ATTESTATION_TTL_MS = 60 * 60_000;

export type AttestationStatus = 'verified' | 'fail_open';

export interface AttestationInput {
  userId: string;
  sessionId: string;
  deviceId: string;
  status: AttestationStatus;
  verdict: VerdictSummary | Record<string, unknown>;
  appVersion?: string | null;
  now?: number;
}

export async function recordAttestation(input: AttestationInput): Promise<void> {
  const now = input.now ?? Date.now();
  const ttl = input.status === 'verified' ? ATTESTATION_TTL_MS : FAIL_OPEN_ATTESTATION_TTL_MS;
  try {
    const { error } = await createAdminSupabase()
      .from('device_attestations')
      .insert({
        user_id: input.userId,
        session_id: input.sessionId,
        device_id: input.deviceId,
        platform: 'android',
        status: input.status,
        verdict: input.verdict,
        app_version: input.appVersion ?? null,
        expires_at: new Date(now + ttl).toISOString(),
      });
    if (error) console.error('[integrity] attestation insert failed:', error.message);
  } catch (err: any) {
    console.error('[integrity] attestation insert threw:', err?.message ?? err);
  }
}

/** `verified` / `fail_open` = a live row of that status; `none`; `error` = lookup failed. */
export type LiveAttestation = AttestationStatus | 'none' | 'error';

/** The unexpired attestation for this user + session + device, preferring a verified one. */
export async function findLiveAttestation(userId: string, sessionId: string, deviceId: string, now = Date.now()): Promise<LiveAttestation> {
  try {
    const { data, error } = await createAdminSupabase()
      .from('device_attestations')
      .select('status')
      .eq('session_id', sessionId)
      .eq('device_id', deviceId)
      .eq('user_id', userId)
      .gt('expires_at', new Date(now).toISOString())
      .limit(10);
    if (error) {
      console.error('[integrity] attestation lookup failed:', error.message);
      return 'error';
    }
    const statuses = ((data ?? []) as Array<{ status: string }>).map((r) => r.status);
    if (statuses.includes('verified')) return 'verified';
    if (statuses.includes('fail_open')) return 'fail_open';
    return 'none';
  } catch (err: any) {
    console.error('[integrity] attestation lookup threw:', err?.message ?? err);
    return 'error';
  }
}

/** Has this device ever passed verification for this user? (any time, verified only) */
export async function isAttestedDevice(userId: string, deviceId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminSupabase()
      .from('device_attestations')
      .select('id')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .eq('status', 'verified')
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/** Device ids that passed verification for a user (verified only, most recent first). */
export async function attestedDeviceIds(userId: string): Promise<string[]> {
  try {
    const { data, error } = await createAdminSupabase()
      .from('device_attestations')
      .select('device_id')
      .eq('user_id', userId)
      .eq('status', 'verified')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return [];
    return Array.from(new Set(((data ?? []) as Array<{ device_id: string }>).map((r) => r.device_id)));
  } catch {
    return [];
  }
}
