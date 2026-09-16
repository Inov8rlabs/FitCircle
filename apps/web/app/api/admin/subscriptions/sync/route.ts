import { type NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'crypto';
import { z } from 'zod';

import { createAdminSupabase } from '@/lib/supabase-admin';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { SubscriptionService } from '@/lib/services/subscription-service';

export const dynamic = 'force-dynamic';

/**
 * Admin API — force a RevenueCat → profile resync for one user (support tool
 * for "I paid but the app shows free").
 *
 *   POST /api/admin/subscriptions/sync  { email | userId }
 *   Authorization: Bearer $ADMIN_API_SECRET
 *
 * Returns the entitlements the apps will see on their next refresh.
 */
function authorized(request: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return NextResponse.json({ error: 'Admin API not configured' }, { status: 503 });
  const a = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  if (!timingSafeEqual(a, b)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
}

const schema = z
  .object({ userId: z.string().uuid().optional(), email: z.string().email().optional() })
  .refine((b) => b.userId || b.email, { message: 'userId or email is required' });

export async function POST(request: NextRequest) {
  const denied = authorized(request);
  if (denied) return denied;
  try {
    const body = schema.parse(await request.json());
    const supabase = createAdminSupabase();
    let query = supabase.from('profiles').select('id, email');
    query = body.userId ? query.eq('id', body.userId) : query.ilike('email', body.email!.trim());
    const { data: profile } = await query.maybeSingle();
    if (!profile) return NextResponse.json({ error: 'No account matches that user id / email' }, { status: 404 });

    await SubscriptionService.syncFromRevenueCat(profile.id);
    const entitlements = await EntitlementService.getEntitlements(profile.id);
    return NextResponse.json({ synced: true, userId: profile.id, email: profile.email, tier: entitlements.tier, subscription: entitlements.subscription });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0]?.message ?? 'Invalid body' }, { status: 400 });
    console.error('[admin sync] failed:', (err as any)?.message);
    return NextResponse.json({ error: (err as any)?.message ?? 'Internal error' }, { status: 500 });
  }
}
