/**
 * Flags, holdouts and limits for lifecycle messaging. Everything defaults OFF
 * in production; see docs/ENGAGEMENT_MESSAGING.md §9 for the rollout order.
 *
 *   ENGAGEMENT_EMAILS_ENABLED=true     onboarding / re-engagement emails
 *   ENGAGEMENT_PUSH_ENABLED=true       onboarding / re-engagement pushes
 *   WEEKLY_REPORT_ENABLED=true         weekly report email
 *   WEEKLY_REPORT_PUSH_ENABLED=true    the short "your week in review" push
 *   WELCOME_EMAIL_ENABLED=false        kill switch for the welcome email (default ON)
 *   ENGAGEMENT_MAX_PER_RUN=200         per-cron-run send budget (each cron)
 *   ENGAGEMENT_HOLDOUTS=weekly_report:5,onboarding_first_meal:0   control group %, per message
 *   ENGAGEMENT_DISABLED_KEYS=a,b       pause individual messages
 *   ENGAGEMENT_TEST_USER_IDS=uuid,…    when set, crons only consider these users (staging / first run)
 */
import { bucketOf, saltedHash } from '../experiments/bucket';

import type { MessageKey } from './types';

type Env = Record<string, string | undefined>;

const ON = new Set(['1', 'true', 'on', 'yes']);
const OFF = new Set(['0', 'false', 'off', 'no']);

const isOn = (v: string | undefined) => ON.has((v ?? '').trim().toLowerCase());
const isOff = (v: string | undefined) => OFF.has((v ?? '').trim().toLowerCase());

export interface EngagementFlags {
  engagementEmails: boolean;
  engagementPush: boolean;
  weeklyReport: boolean;
  weeklyReportPush: boolean;
  welcomeEmail: boolean;
}

export function engagementFlags(env: Env = process.env): EngagementFlags {
  return {
    engagementEmails: isOn(env.ENGAGEMENT_EMAILS_ENABLED),
    engagementPush: isOn(env.ENGAGEMENT_PUSH_ENABLED),
    weeklyReport: isOn(env.WEEKLY_REPORT_ENABLED),
    weeklyReportPush: isOn(env.WEEKLY_REPORT_PUSH_ENABLED),
    welcomeEmail: !isOff(env.WELCOME_EMAIL_ENABLED),
  };
}

export const DEFAULT_MAX_PER_RUN = 200;

export function maxPerRun(env: Env = process.env): number {
  const n = Number(env.ENGAGEMENT_MAX_PER_RUN);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 2000) : DEFAULT_MAX_PER_RUN;
}

export function disabledKeys(env: Env = process.env): Set<string> {
  return new Set((env.ENGAGEMENT_DISABLED_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

export function testUserIds(env: Env = process.env): string[] | null {
  const ids = (env.ENGAGEMENT_TEST_USER_IDS ?? '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  return ids.length ? ids : null;
}

/** Default control-group percentages. Weekly report 5 %, everything else 0. */
export const DEFAULT_HOLDOUTS: Partial<Record<MessageKey, number>> = { weekly_report: 5 };

export function holdoutPct(key: MessageKey, env: Env = process.env): number {
  const raw = env.ENGAGEMENT_HOLDOUTS;
  if (raw) {
    for (const part of raw.split(',')) {
      const [k, v] = part.split(':').map((s) => s.trim());
      if (k === key) {
        const n = Number(v);
        if (Number.isFinite(n)) return Math.max(0, Math.min(50, n));
      }
    }
  }
  return DEFAULT_HOLDOUTS[key] ?? 0;
}

/**
 * Deterministic, sticky control group: the same user is always in (or out of)
 * a message's holdout, so lift compares like with like across weeks. Salt is
 * per message so holdouts don't stack on the same people.
 */
export function isHoldout(userId: string, key: MessageKey, pct: number): boolean {
  if (pct <= 0) return false;
  return bucketOf(userId, `engagement-holdout:${key}`, 10_000) < Math.round(pct * 100);
}

/** Deterministic pick from a list for (user, salt) — used for copy rotation. */
export function pick<T>(items: readonly T[], userId: string, salt: string): T {
  return items[saltedHash(userId, salt) % items.length];
}

/** Deterministic number in [0, 1) for (user, salt). */
export function unitHash(userId: string, salt: string): number {
  return saltedHash(userId, salt) / 2 ** 32;
}
