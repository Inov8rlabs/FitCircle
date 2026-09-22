/**
 * Social sign-in (Apple / Google): find the account for a verified email or
 * create it, and say which one happened so clients can route first-time
 * users through onboarding instead of straight to the feed.
 *
 * Shared by /api/mobile/auth/apple and /api/mobile/auth/google.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { deriveUsernameBase, ensureUniqueUsername } from './username-service';

export type SocialProvider = 'apple' | 'google';

export interface SocialUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  provider: SocialProvider;
  /** The provider's stable user id (Apple `sub`, Google `sub`). */
  providerUserId: string;
}

export interface SocialUserResult {
  userId: string;
  profile: Record<string, any> | null;
  /** True when this call created the account. */
  isNewUser: boolean;
}

export class SocialAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'USER_CREATION_FAILED' | 'PROFILE_CREATION_FAILED'
  ) {
    super(message);
    this.name = 'SocialAuthError';
  }
}

const LIST_USERS_PAGE = 1000;

/** Supabase's admin API has no lookup by email; scan pages only as a fallback. */
async function findAuthUserIdByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<string | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: LIST_USERS_PAGE });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (hit) return hit.id;
    if (data.users.length < LIST_USERS_PAGE) return null;
  }
  return null;
}

function isAlreadyRegistered(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return text.includes('already') || text.includes('exists') || text.includes('duplicate');
}

export async function findOrCreateSocialUser(
  supabase: SupabaseClient,
  input: SocialUserInput
): Promise<SocialUserResult> {
  const email = input.email.trim();

  // 1. Fast path: a profile row already carries this email (register and both
  //    social routes write it). Case-insensitive because Apple relay addresses
  //    and Google addresses can differ in case between sign-ins.
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('*')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();

  if (existingProfile?.id) {
    return { userId: existingProfile.id, profile: existingProfile, isNewUser: false };
  }

  // 2. Create the auth user. A collision here means an account exists without
  //    a profile email (older accounts); resolve it through the admin list.
  const crypto = await import('crypto');
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomBytes(32).toString('hex'),
    user_metadata: {
      first_name: input.firstName ?? '',
      last_name: input.lastName ?? '',
      [`${input.provider}_identifier`]: input.providerUserId,
      provider: input.provider,
    },
  });

  let userId = created?.user?.id ?? null;
  let isNewUser = Boolean(userId);

  if (!userId) {
    if (!isAlreadyRegistered(createError)) {
      console.error(`[${input.provider} auth] createUser failed:`, createError);
      throw new SocialAuthError('Failed to create user account', 'USER_CREATION_FAILED');
    }
    userId = await findAuthUserIdByEmail(supabase, email);
    if (!userId) {
      console.error(`[${input.provider} auth] email registered but user not found:`, email);
      throw new SocialAuthError('Failed to create user account', 'USER_CREATION_FAILED');
    }
    isNewUser = false;
  }

  // 3. Make sure a profile exists. Existing account, missing profile → still
  //    create one so the app has something to load; that user is not "new".
  const { data: profileById } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (profileById) {
    if (!profileById.email) {
      await supabase.from('profiles').update({ email, updated_at: new Date().toISOString() }).eq('id', userId);
    }
    return { userId, profile: profileById, isNewUser };
  }

  const usernameTaken = async (candidate: string): Promise<boolean> => {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', candidate)
      .limit(1)
      .maybeSingle();
    return !!data;
  };
  const username = await ensureUniqueUsername(deriveUsernameBase(email), usernameTaken);
  const displayName =
    [input.firstName, input.lastName].map((s) => s?.trim()).filter(Boolean).join(' ') || username;
  const now = new Date().toISOString();

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      email,
      username,
      display_name: displayName,
      onboarding_completed: false,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (profileError || !profile) {
    console.error(`[${input.provider} auth] profile upsert failed:`, profileError);
    throw new SocialAuthError('Failed to create user profile', 'PROFILE_CREATION_FAILED');
  }

  return { userId, profile, isNewUser };
}
