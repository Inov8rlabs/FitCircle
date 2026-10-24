/**
 * Admin gate for /api/admin/campaigns/** and /api/admin/me
 * (docs/CAMPAIGNS_SPEC.md §8). Accepts, in order:
 *  1. `Authorization: Bearer $ADMIN_API_SECRET` (scripts; no user),
 *  2. a mobile Bearer access token, or
 *  3. the web Supabase cookie session (both via requireMobileAuth),
 * and then requires `profiles.is_admin`.
 *
 * Secret callers (the separate admin app, server-to-server) identify the
 * signed-in admin with `X-Admin-Actor: <email>`. When that email belongs to an
 * is_admin profile, the caller acts as that user (userId/profile populated,
 * viaSecret stays true) so "as me" routes (preview, test sends) work; an email
 * with no admin profile is still carried as actorEmail for audit logs.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { type NextRequest } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { CampaignError } from './http';

export interface AdminCaller {
  /** Null when authenticated with ADMIN_API_SECRET (no user context). */
  userId: string | null;
  profile: Record<string, any> | null;
  viaSecret: boolean;
  /** X-Admin-Actor email on secret calls (lower-cased), else the admin's own email. */
  actorEmail: string | null;
}

const ACTOR_EMAIL_RE = /^[^\s@<>]{1,128}@[^\s@<>]{1,128}$/;

/** The X-Admin-Actor header, normalised, or null when absent / not an email. */
export function adminActorEmail(request: NextRequest): string | null {
  const raw = (request.headers.get('x-admin-actor') ?? '').trim();
  return raw && ACTOR_EMAIL_RE.test(raw) ? raw.toLowerCase().slice(0, 254) : null;
}

async function adminProfileByEmail(email: string): Promise<Record<string, any> | null> {
  try {
    const { data } = await createAdminSupabase().from('profiles').select('*').eq('email', email).eq('is_admin', true).limit(1).maybeSingle();
    return (data as Record<string, any> | null) ?? null;
  } catch (e: any) {
    console.warn('[admin-auth] actor lookup failed:', e?.message);
    return null;
  }
}

function isAdminSecret(request: NextRequest): boolean {
  const secret = process.env.ADMIN_API_SECRET;
  const provided = request.headers.get('authorization') ?? '';
  if (!secret || !provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/** The caller's admin flag (reads the column when the auth profile lacks it). */
export async function isAdminProfile(profile: Record<string, any> | null | undefined): Promise<boolean> {
  if (!profile?.id) return false;
  if (typeof profile.is_admin === 'boolean') return profile.is_admin;
  const { data } = await createAdminSupabase().from('profiles').select('is_admin').eq('id', profile.id).maybeSingle();
  return (data as { is_admin?: boolean } | null)?.is_admin === true;
}

/** Signed-in caller (any user) or 401. */
export async function requireUser(request: NextRequest): Promise<Record<string, any>> {
  try {
    return await requireMobileAuth(request);
  } catch {
    throw new CampaignError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

export async function requireAdmin(request: NextRequest): Promise<AdminCaller> {
  if (isAdminSecret(request)) {
    const actorEmail = adminActorEmail(request);
    const actor = actorEmail ? await adminProfileByEmail(actorEmail) : null;
    return { userId: (actor?.id as string | undefined) ?? null, profile: actor, viaSecret: true, actorEmail };
  }
  const profile = await requireUser(request);
  if (!(await isAdminProfile(profile))) throw new CampaignError(403, 'FORBIDDEN', 'Admins only');
  return { userId: profile.id as string, profile, viaSecret: false, actorEmail: typeof profile.email === 'string' ? profile.email : null };
}

/** Admin routes that act "as me" (preview, test sends) need a real user. */
export function requireAdminUser(caller: AdminCaller): string {
  if (!caller.userId) throw new CampaignError(400, 'USER_REQUIRED', 'This action needs a signed-in admin (or X-Admin-Actor naming an admin), not the bare API secret');
  return caller.userId;
}
