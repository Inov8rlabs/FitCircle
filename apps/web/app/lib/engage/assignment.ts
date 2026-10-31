/**
 * Deterministic variant assignment (docs/ENGAGE_SPEC.md §5):
 * bucket = hash(userId + messageId) % 100 → control if < controlWeight, else
 * walk the variants' weights. Stable per user and message.
 */
import { createHash } from 'node:crypto';

export function stableBucket(...parts: string[]): number {
  const h = createHash('sha256').update(parts.join(':')).digest();
  return h.readUInt32BE(0) % 100;
}

export const CONTROL = 'control';

export function assignVariant(
  userId: string,
  messageId: string,
  variants: Array<{ id: string; weight: number }>,
  controlWeight: number
): string {
  const bucket = stableBucket(userId, messageId);
  if (bucket < controlWeight) return CONTROL;
  let edge = controlWeight;
  for (const v of variants) {
    edge += Math.max(0, v.weight);
    if (bucket < edge) return v.id;
  }
  // Weights that don't reach 100 (shouldn't pass validation): last variant takes the rest.
  return variants.length ? variants[variants.length - 1].id : CONTROL;
}

/** The `random_bucket` attribute (0–99) for % rollouts. */
export function randomBucket(userId: string): number {
  return stableBucket('segment-bucket', userId);
}
