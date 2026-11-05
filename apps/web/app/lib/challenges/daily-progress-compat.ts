/**
 * Daily-challenge progress units for shipped iOS builds.
 *
 * The contract is ABSOLUTE units of the challenge (`goal_amount` / `unit`): Android
 * posts the running total, and the server completes the challenge at progress >= goal.
 * Shipped iOS (DailyChallengeFeature) posts `min(entered / goal, 1.0)` — a 0..1
 * FRACTION — and reads `user_progress` / leaderboard `progress` back as a fraction
 * (`progressPercentage = min(userProgress, 1)`, `currentValue = userProgress * goal`).
 * Stored as-is, an iOS member "finishing" 10,000 steps stored 1: never completed, and
 * ranked below every Android member.
 *
 * A fixed iOS build posts absolute units and declares `X-Client-Features:
 * challenge_progress_abs`. Any other iOS request is a fraction client: its posted
 * fraction is converted to absolute units before storing, and the progress values it
 * reads are converted back to fractions, so its screens keep working.
 *
 * iOS is identified by `X-App-Platform: ios` (the header every client sends since
 * 1.1.0 / Android 1.1.0). Older iOS builds send no platform header at all; for those
 * the User-Agent decides: iOS URLSession sends `<App>/<build> CFNetwork/… Darwin/…`,
 * Android OkHttp sends `okhttp/…`.
 */
import { CLIENT_FEATURES_HEADER } from '@/lib/design/icon-compat';
import { parseClientPlatform } from '@/lib/experiments/request-info';

type HeaderSource = { headers: { get(name: string): string | null } };

/** Capability a client sends when it posts and reads daily-challenge progress in absolute units. */
export const CHALLENGE_PROGRESS_ABS_FEATURE = 'challenge_progress_abs';

export function declaresAbsoluteProgress(features: string | null | undefined): boolean {
  return (features ?? '')
    .split(',')
    .some((f) => f.trim().toLowerCase() === CHALLENGE_PROGRESS_ABS_FEATURE);
}

export function isIosRequest(request: HeaderSource): boolean {
  const h = request.headers;
  const declared = (h.get('x-app-platform') ?? h.get('x-platform') ?? '').trim();
  if (declared) return parseClientPlatform(declared) === 'ios';
  return /\bCFNetwork\/|\bDarwin\//.test(h.get('user-agent') ?? '');
}

/** True for shipped iOS builds that post and read progress as a 0..1 fraction of the goal. */
export function usesFractionProgress(request: HeaderSource): boolean {
  return isIosRequest(request) && !declaresAbsoluteProgress(request.headers.get(CLIENT_FEATURES_HEADER));
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * A posted fraction → absolute units. Those builds clamp to 1, so a value above 1
 * cannot be a fraction and is kept as-is.
 */
export function fractionToAbsolute(progress: number, goalAmount: number): number {
  if (!(goalAmount > 0) || progress > 1) return progress;
  return round(progress * goalAmount);
}

/** Absolute units → the fraction those builds read (not capped: they cap for the bar themselves). */
export function absoluteToFraction(progress: number, goalAmount: number): number {
  if (!(goalAmount > 0)) return progress;
  return round(progress / goalAmount);
}
