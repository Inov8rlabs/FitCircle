import { createAdminSupabase } from '../supabase-admin';
import { coerceDisplayName } from '../validation/display-name';

import { USERNAME_PATTERN, deriveUsernameBase, ensureUniqueUsername } from './username-service';

/**
 * Make sure `profiles` has a row for this auth user.
 *
 * Mobile signups create the row in the register route, but a WEB signup
 * (`supabase.auth.signUp` from the browser, stores/auth-store.ts) gets its row
 * only when web onboarding saves (hooks/useProfile.ts inserts it). Anything that
 * runs right after a web signup — the invite claim, the circle join — used to
 * find no profile: `ReferralService.claim` answered INVALID_CODE "Account not
 * found" (silently swallowed) and a member insert would violate
 * `fitcircle_members.user_id → profiles(id)`.
 *
 * Creates a minimal row (email, a unique username, display name from the
 * signup metadata, onboarding_completed=false); web onboarding later UPDATEs it
 * (useProfile checks for an existing row first). Best-effort: returns whether a
 * row exists afterwards, never throws.
 */
export async function ensureProfileRow(userId: string): Promise<boolean> {
  try {
    const supabase = createAdminSupabase() as any;
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (existing) return true;

    const getUserById = supabase.auth?.admin?.getUserById;
    if (typeof getUserById !== 'function') return false;
    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
    const authUser = authData?.user;
    if (authError || !authUser) return false;

    const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const email: string | null = authUser.email ?? null;
    if (!email) return false; // profiles.email is NOT NULL
    const displayName = str(meta.full_name) ?? str(meta.name) ?? str(meta.display_name);

    const usernameTaken = async (candidate: string): Promise<boolean> => {
      const { data } = await supabase.from('profiles').select('id').ilike('username', candidate).limit(1).maybeSingle();
      return !!data;
    };
    const wanted = str(meta.username);
    const username =
      wanted && USERNAME_PATTERN.test(wanted) && !(await usernameTaken(wanted))
        ? wanted
        : await ensureUniqueUsername(deriveUsernameBase(email), usernameTaken);

    const now = new Date().toISOString();
    const { error } = await supabase.from('profiles').insert({
      id: userId,
      email,
      username,
      display_name: coerceDisplayName(displayName, username), // NOT NULL
      onboarding_completed: false,
      created_at: now,
      updated_at: now,
    });
    if (!error) return true;
    // 23505: a concurrent request (or web onboarding) created it first.
    if (error.code === '23505') {
      const { data: raced } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
      return !!raced;
    }
    console.error('[ensureProfileRow] insert failed', { userId, code: error.code, message: error.message });
    return false;
  } catch (error) {
    console.error('[ensureProfileRow] failed', { userId, error: (error as Error)?.message });
    return false;
  }
}
