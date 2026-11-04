/**
 * Shared request handling for the engagement crons: CRON_SECRET (fail
 * closed), `?dryRun=1`, `?userId=` (one user), `?max=` (≤ the env budget),
 * and — dry runs only — `?ignoreWindow=1` and `?now=<ISO>` to preview a send
 * window without waiting for it.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { maxPerRun, testUserIds } from './config';

export interface CronParams {
  dryRun: boolean;
  onlyUserIds: string[] | null;
  max: number;
  ignoreWindow: boolean;
  now: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cronAuthError(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export function parseCronParams(request: NextRequest): CronParams | NextResponse {
  const q = request.nextUrl.searchParams;
  const dryRun = ['1', 'true'].includes(q.get('dryRun') ?? '');
  const userId = q.get('userId');
  if (userId && !UUID.test(userId)) return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 });
  const envMax = maxPerRun();
  const asked = Number(q.get('max'));
  const max = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), envMax) : envMax;
  let now = new Date();
  const nowParam = q.get('now');
  if (dryRun && nowParam) {
    const t = Date.parse(nowParam);
    if (!Number.isFinite(t)) return NextResponse.json({ error: 'now must be an ISO timestamp' }, { status: 400 });
    now = new Date(t);
  }
  const allow = testUserIds();
  let onlyUserIds: string[] | null = allow;
  if (userId) {
    if (allow && !allow.includes(userId)) return NextResponse.json({ error: 'userId is not in ENGAGEMENT_TEST_USER_IDS' }, { status: 400 });
    onlyUserIds = [userId];
  }
  return { dryRun, onlyUserIds, max, ignoreWindow: dryRun && ['1', 'true'].includes(q.get('ignoreWindow') ?? ''), now };
}

export const postalAddress = () => process.env.EMAIL_POSTAL_ADDRESS || null;
