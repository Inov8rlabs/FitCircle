/**
 * Deterministic, salted bucketing shared by the experiments system, the home
 * feed rules and promo creatives (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.3).
 *
 *   hash   = first 4 bytes (big-endian uint32) of sha256(`${salt}:${userId}`)
 *   bucket = hash mod N
 *
 * The home feed and promos use N = 100 (`bucketOf`); experiments use
 * N = 10 000 (`experimentBucket`) so arm weights get 0.01 % resolution.
 * The hash input and byte order must never change: doing so would reshuffle
 * every running experiment and rollout.
 */
import { createHash } from 'node:crypto';

/** Experiments bucket into 0–9 999. */
export const EXPERIMENT_BUCKETS = 10_000;

/** sha256(`${salt}:${userId}`) → first 4 bytes as an unsigned 32-bit integer. */
export function saltedHash(userId: string, salt: string): number {
  return createHash('sha256').update(`${salt}:${userId}`).digest().readUInt32BE(0);
}

/** Deterministic bucket in [0, modulo). Default 0–99 (home feed / promos). */
export function bucketOf(userId: string, salt: string, modulo = 100): number {
  return saltedHash(userId, salt) % modulo;
}

/** Experiment bucket in [0, 10 000). */
export function experimentBucket(userId: string, salt: string): number {
  return bucketOf(userId, salt, EXPERIMENT_BUCKETS);
}
