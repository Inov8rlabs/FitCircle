import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { bucketOf as feedBucketOf, matchesRollout, assignArm } from '../../home-feed/rules';
import { EXPERIMENT_BUCKETS, bucketOf, experimentBucket, saltedHash } from '../bucket';

/** The pre-refactor home-feed implementation, verbatim (lib/home-feed/rules.ts before 112). */
function legacyBucketOf(userId: string, salt: string): number {
  const digest = createHash('sha256').update(`${salt}:${userId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

const uuid = (i: number) => {
  const h = createHash('md5').update(String(i)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const USERS = Array.from({ length: 5000 }, (_, i) => uuid(i));
const SALTS = ['water_first', 'pro_value', 'roll', 'a', 'b', 'onboarding_v2', 'x:traffic'];

describe('shared bucketing (lib/experiments/bucket.ts)', () => {
  it('home feed buckets are byte-identical to the pre-refactor implementation', () => {
    for (const salt of SALTS) for (const u of USERS) expect(feedBucketOf(u, salt)).toBe(legacyBucketOf(u, salt));
  });

  it('home feed re-exports the shared helper (one implementation)', () => {
    expect(feedBucketOf).toBe(bucketOf);
  });

  it('keeps the pinned home-feed values', () => {
    expect(bucketOf('11111111-1111-4111-8111-111111111111', 'water_first')).toBe(65);
    expect(bucketOf('22222222-2222-4222-8222-222222222222', 'water_first')).toBe(75);
  });

  it('rollouts and feed experiment arms are unchanged', () => {
    for (const u of USERS.slice(0, 500)) {
      expect(matchesRollout({ key: 'roll', audience: { percent: 30 } }, u)).toBe(legacyBucketOf(u, 'roll') < 30);
      const arm = assignArm({ key: 'exp', arms: [{ name: 'a', percent: 50, actions: [] }, { name: 'b', percent: 50, actions: [] }] }, u);
      expect(arm?.name).toBe(legacyBucketOf(u, 'exp') < 50 ? 'a' : 'b');
    }
  });

  it('experiment buckets are the same hash mod 10 000', () => {
    for (const u of USERS.slice(0, 1000)) {
      const b = experimentBucket(u, 'salt');
      expect(b).toBe(saltedHash(u, 'salt') % EXPERIMENT_BUCKETS);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(10_000);
      expect(experimentBucket(u, 'salt')).toBe(b);
    }
  });

  it('experiment buckets are roughly uniform at 0.01 % resolution', () => {
    const low = USERS.filter((u) => experimentBucket(u, 'onboarding_v2') < 2000).length / USERS.length;
    expect(low).toBeGreaterThan(0.17);
    expect(low).toBeLessThan(0.23);
  });
});
