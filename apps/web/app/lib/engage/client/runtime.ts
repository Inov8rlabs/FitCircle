/**
 * Web Engage runtime (ENGAGE_SPEC §7, §8, §13): delivery fetch with
 * `x-platform: web`, a batched + persisted event queue for
 * /api/mobile/engage/events, the app-event bus that drives in-app triggers,
 * and local in-app caps. Browser-only module state; safe to import on the server.
 */

import { apiRequest } from '@/lib/campaigns/admin-client';

import type { AppEventName, EngageEventInput, EngageResponse, InAppView, TriggerFilter } from '../types';

export const APP_EVENT = 'engage:app-event';
const QUEUE_KEY = 'fc_engage_queue_v1';
const SHOWN_KEY = 'fc_engage_iam_shown_v1';
const SESSION_KEY = 'fc_engage_iam_session_v1';
const MAX_BATCH = 50;
const FLUSH_MS = 30_000;

export function fetchEngage(): Promise<EngageResponse> {
  return apiRequest<EngageResponse>('/api/mobile/engage', { headers: { 'x-platform': 'web', 'x-app-version': 'web' } });
}

// ---------------------------------------------------------------------------
// Event queue
// ---------------------------------------------------------------------------

let queue: EngageEventInput[] = [];
let timer: number | null = null;
let flushing = false;
let started = false;

function load(): EngageEventInput[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as EngageEventInput[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-500) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-500)));
  } catch {
    // storage full / blocked
  }
}

export async function flushEvents(): Promise<void> {
  if (flushing || typeof window === 'undefined' || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length) {
      const batch = queue.slice(0, MAX_BATCH);
      await apiRequest('/api/mobile/engage/events', { method: 'POST', body: JSON.stringify({ events: batch }), headers: { 'x-platform': 'web' } });
      queue = queue.slice(batch.length);
      persist();
    }
  } catch {
    // keep the queue; retry on the next tick
  } finally {
    flushing = false;
  }
}

export function startEventQueue(): () => void {
  if (typeof window === 'undefined' || started) return () => undefined;
  started = true;
  queue = [...load(), ...queue];
  timer = window.setInterval(() => void flushEvents(), FLUSH_MS);
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushEvents();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  return () => {
    started = false;
    if (timer) window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
  };
}

export function trackEngage(ev: Omit<EngageEventInput, 'at'> & { at?: string }): void {
  if (typeof window === 'undefined') return;
  queue.push({ ...ev, at: ev.at ?? new Date().toISOString() });
  persist();
  if (queue.length >= MAX_BATCH) void flushEvents();
}

// ---------------------------------------------------------------------------
// App events (also drive on-device in-app triggers)
// ---------------------------------------------------------------------------

export interface AppEventDetail {
  name: AppEventName;
  props: Record<string, string | number | boolean | null>;
}

export function emitAppEvent(name: AppEventName, props: Record<string, string | number | boolean | null> = {}): void {
  if (typeof window === 'undefined') return;
  trackEngage({ type: 'app_event', name, props });
  window.dispatchEvent(new CustomEvent<AppEventDetail>(APP_EVENT, { detail: { name, props } }));
}

/** Web route → screen key used by `screen_view` and deeplinks. */
export function screenForPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/dashboard') return 'home';
  if (p.startsWith('/fitcircles')) return 'circles';
  if (p.startsWith('/food-log')) return 'food_log';
  if (p.startsWith('/profile')) return 'profile';
  if (p.startsWith('/invite')) return 'invite_hub';
  if (p.startsWith('/upgrade')) return 'paywall';
  if (p.startsWith('/c/')) return 'campaign';
  if (p.startsWith('/streaks')) return 'streaks';
  if (p.startsWith('/exercise-log')) return 'workouts';
  return null;
}

/** Deeplink / screen key → web route. */
export function routeForScreen(key: string | null | undefined): string {
  switch ((key ?? '').toLowerCase()) {
    case 'circles':
      return '/fitcircles';
    case 'food_log':
    case 'log_meal':
      return '/food-log';
    case 'profile':
    case 'settings':
      return '/profile';
    case 'invite_hub':
    case 'invite':
      return '/invite';
    case 'paywall':
    case 'upgrade':
      return '/upgrade';
    case 'streaks':
      return '/streaks';
    case 'workouts':
      return '/exercise-log';
    default:
      return '/dashboard';
  }
}

// ---------------------------------------------------------------------------
// In-app trigger matching + local caps
// ---------------------------------------------------------------------------

export function filterMatches(f: TriggerFilter, props: Record<string, unknown>): boolean {
  const v = props[f.key];
  const num = (x: unknown) => (typeof x === 'number' ? x : Number(x));
  switch (f.op) {
    case 'eq':
      return String(v) === String(f.value);
    case 'neq':
      return String(v) !== String(f.value);
    case 'gt':
      return num(v) > num(f.value);
    case 'gte':
      return num(v) >= num(f.value);
    case 'lt':
      return num(v) < num(f.value);
    case 'lte':
      return num(v) <= num(f.value);
    case 'in':
      return Array.isArray(f.value) && f.value.map(String).includes(String(v));
    default:
      return false;
  }
}

export function triggerMatches(m: Pick<InAppView, 'trigger'>, ev: AppEventDetail): boolean {
  if (m.trigger.event !== ev.name) return false;
  return (m.trigger.filters ?? []).every((f) => filterMatches(f, ev.props));
}

interface ShownLog {
  [messageId: string]: string[]; // ISO timestamps
}

function readShown(): ShownLog {
  try {
    return (JSON.parse(window.localStorage.getItem(SHOWN_KEY) ?? '{}') as ShownLog) ?? {};
  } catch {
    return {};
  }
}

function sessionCount(): number {
  try {
    return Number(window.sessionStorage.getItem(SESSION_KEY) ?? '0') || 0;
  } catch {
    return 0;
  }
}

/** Pure cap check (exported for tests). */
export function capsAllow(
  m: Pick<InAppView, 'messageId' | 'maxImpressions' | 'minHoursBetween' | 'impressionsSoFar' | 'lastShownAt' | 'respectGlobalCap'>,
  shown: ShownLog,
  sessionShown: number,
  caps: { inAppPer24h: number; inAppPerSession: number },
  now: number = Date.now()
): boolean {
  const mine = shown[m.messageId] ?? [];
  const total = Math.max(m.impressionsSoFar ?? 0, mine.length);
  if (m.maxImpressions != null && total >= m.maxImpressions) return false;
  const last = Math.max(m.lastShownAt ? Date.parse(m.lastShownAt) : 0, ...mine.map((t) => Date.parse(t)));
  if (m.minHoursBetween != null && last && now - last < m.minHoursBetween * 3_600_000) return false;
  if (m.respectGlobalCap !== false) {
    if (sessionShown >= caps.inAppPerSession) return false;
    const day = Object.values(shown).flat().filter((t) => now - Date.parse(t) < 86_400_000).length;
    if (day >= caps.inAppPer24h) return false;
  }
  return true;
}

export function canShowInApp(m: InAppView, caps: { inAppPer24h: number; inAppPerSession: number }): boolean {
  if (typeof window === 'undefined') return false;
  return capsAllow(m, readShown(), sessionCount(), caps);
}

export function recordInAppShown(messageId: string): void {
  try {
    const shown = readShown();
    const cutoff = Date.now() - 30 * 86_400_000;
    shown[messageId] = [...(shown[messageId] ?? []).filter((t) => Date.parse(t) > cutoff), new Date().toISOString()];
    window.localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
    window.sessionStorage.setItem(SESSION_KEY, String(sessionCount() + 1));
  } catch {
    // ignore
  }
}
