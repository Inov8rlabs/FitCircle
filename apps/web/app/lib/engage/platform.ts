/**
 * Caller platform (docs/ENGAGE_SPEC.md §15): `x-platform: ios|android|web`;
 * cookie-session requests without the header are web; Bearer requests without
 * it fall back to a User-Agent sniff (older builds), else unknown (null).
 */
import type { EngagePlatform } from './types';

export const PLATFORMS: readonly EngagePlatform[] = ['ios', 'android', 'web'];

export function isPlatform(v: unknown): v is EngagePlatform {
  return typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);
}

export function resolvePlatform(request: { headers: Headers }): EngagePlatform | null {
  const h = request.headers.get('x-platform')?.trim().toLowerCase();
  if (isPlatform(h)) return h;
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return 'web';
  const ua = request.headers.get('user-agent') ?? '';
  if (/okhttp|Dalvik|Android/i.test(ua)) return 'android';
  if (/CFNetwork|Darwin|iPhone|iOS/i.test(ua)) return 'ios';
  return null;
}

/** Does a platform-targeted item (empty = all) reach this caller? */
export function platformAllowed(targets: readonly string[] | null | undefined, platform: EngagePlatform | null): boolean {
  if (!targets || targets.length === 0) return true;
  return platform !== null && targets.includes(platform);
}
