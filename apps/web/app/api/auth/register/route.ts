import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isRegionRestricted, regionNotAvailableBody } from '@/lib/geo/region-restriction';
import { CLEAR_FC_REF_COOKIE, PENDING_INVITE_METADATA_KEY, claimWebInvite, resolveWebInvite } from '@/lib/referrals/web-claim';
import { enforceAbuseLimits } from '@/lib/security/abuse-limits';
import { recordSecurityEvent } from '@/lib/security/security-events';
import {
  createEmailAccount,
  sendSignupConfirmation,
  setEmailCanonical,
  signupRequiresConfirmation,
} from '@/lib/services/email-signup-service';
import { ensureProfileRow } from '@/lib/services/profile-bootstrap';
import {
  USERNAME_PATTERN,
  USERNAME_RULES_MESSAGE,
  deriveUsernameBase,
  ensureUniqueUsername,
} from '@/lib/services/username-service';
import { triggerWelcomeEmail } from '@/lib/services/welcome-email-service';
import { ageRequirementBody, isUnderMinimumAgeByYear } from '@/lib/validation/age-requirement';
import { authEmailSchema } from '@/lib/validation/auth-email';
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from '@/lib/validation/disposable-email';

/**
 * A session for an account we just created (what `signUp` used to return). Uses its own
 * client so the service-role client above never switches to the user's token. Null on
 * any failure: the browser signs in itself when no session comes back.
 */
async function passwordSession(email: string, password: string) {
  try {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) console.warn('[register] post-signup sign-in failed:', error.message);
    return error ? null : (data?.session ?? null);
  } catch (err: any) {
    console.warn('[register] post-signup sign-in threw:', err?.message ?? err);
    return null;
  }
}

// Validation schema
const registerSchema = z.object({
  email: authEmailSchema(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  // Optional: derived from the email when the form doesn't collect one.
  username: z.string().trim().regex(USERNAME_PATTERN, USERNAME_RULES_MESSAGE).optional(),
  // Optional invite attribution (docs/REFERRALS_SPEC.md §4 Web). Falls back to the fc_ref cookie.
  ref: z.string().max(32).optional(),
  circle: z.string().max(32).optional(),
  // 18+ (docs/PRIVACY_COMPLIANCE_SPEC.md §5): optional here; under 18 → 400 AGE_REQUIREMENT.
  birthYear: z.number().int().min(1900).max(3000).optional(),
});

export async function POST(request: NextRequest) {
  // EU/EEA restriction (WEB_EU_SIGNUP_BLOCK, default on; lib/geo/region-restriction.ts).
  if (isRegionRestricted(request)) return NextResponse.json(regionNotAvailableBody(), { status: 403 });
  try {
    // Shared limits: 3/h + 10/day per IP (lib/security/abuse-limits.ts).
    const rateLimitResponse = await enforceAbuseLimits(request, 'register');
    if (rateLimitResponse) return rateLimitResponse;

    // Parse and validate request body
    const body = await request.json();
    const validatedData = registerSchema.parse(body);
    if (isDisposableEmail(validatedData.email)) {
      await recordSecurityEvent(request, { kind: 'signup_block', result: 'block', reason: 'disposable_email', action: 'register' });
      return NextResponse.json({ error: DISPOSABLE_EMAIL_MESSAGE, code: 'DISPOSABLE_EMAIL' }, { status: 400 });
    }
    if (validatedData.birthYear !== undefined && isUnderMinimumAgeByYear(validatedData.birthYear)) {
      return NextResponse.json(ageRequirementBody('birthYear'), { status: 400 });
    }

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Resolve a valid, unique username (explicit or derived from the email).
    const usernameTaken = async (candidate: string): Promise<boolean> => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', candidate)
        .limit(1)
        .maybeSingle();
      return !!data;
    };
    let username: string;
    if (validatedData.username) {
      if (await usernameTaken(validatedData.username)) {
        return NextResponse.json({ error: 'This username is already in use' }, { status: 409 });
      }
      username = validatedData.username;
    } else {
      username = await ensureUniqueUsername(deriveUsernameBase(validatedData.email), usernameTaken);
    }

    // Create the account with the Auth admin API (public sign-up can stay off).
    const invite = resolveWebInvite(
      { ref: validatedData.ref, circle: validatedData.circle },
      request.headers.get('cookie')
    );
    const requireConfirmation = signupRequiresConfirmation();
    const created = await createEmailAccount(supabase, {
      email: validatedData.email,
      password: validatedData.password,
      requireConfirmation,
      metadata: {
        display_name: validatedData.fullName,
        name: validatedData.fullName,
        username,
        ...(validatedData.birthYear !== undefined ? { birth_year: validatedData.birthYear } : {}),
        // Same key the browser sign-up used, so /api/referrals/claim can still settle it later.
        ...(invite ? { [PENDING_INVITE_METADATA_KEY]: { code: invite.code, ref: invite.ref } } : {}),
      },
    });

    if (!created.ok) {
      return NextResponse.json(
        { error: created.failure.kind === 'error' ? 'Failed to create user' : created.failure.message },
        { status: created.failure.kind === 'error' ? 500 : 400 }
      );
    }
    const authData = { user: created.user };
    // Create user profile in database
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email: validatedData.email,
        display_name: validatedData.fullName,
        username,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      // Never silently: the invite claim + circle join below need this row
      // (fitcircle_members/referrals FK to profiles). Fall back to the shared
      // bootstrap (unique username, display name from metadata).
      console.error('[register] profile insert failed', {
        userId: authData.user.id,
        code: profileError.code,
        message: profileError.message,
      });
      const ensured = await ensureProfileRow(authData.user.id);
      if (!ensured) console.error('[register] profile still missing after bootstrap', { userId: authData.user.id });
    }

    await setEmailCanonical(supabase, authData.user.id, validatedData.email);
    await recordSecurityEvent(request, { kind: 'signup', result: 'pass', action: 'register', reason: 'email', userId: authData.user.id });
    if (requireConfirmation) {
      await sendSignupConfirmation(supabase, {
        email: validatedData.email,
        password: validatedData.password,
        userId: authData.user.id,
        redirectTo: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/onboarding` : undefined,
      });
    }

    // New account: one welcome email, after the response (never fails registration;
    // once-only per user across platforms — lib/services/welcome-email-service.ts).
    triggerWelcomeEmail({
      userId: authData.user.id,
      email: validatedData.email,
      displayName: validatedData.fullName,
      method: 'email',
      platform: 'web',
    });

    // Invite: attribution + circle join (runs after the profile exists).
    // Best-effort, never fails registration.
    const referral = invite ? await claimWebInvite(authData.user.id, invite) : null;

    // signUp returned a session when no confirmation was required; keep that contract.
    const session = requireConfirmation ? null : await passwordSession(validatedData.email, validatedData.password);

    // Return success response
    const response = NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: validatedData.fullName,
      },
      session,
      circleJoin: referral?.circleJoin ?? null,
      message: 'Registration successful! Check your email for a welcome message.'
    });
    if (referral?.settled) {
      response.cookies.set(CLEAR_FC_REF_COOKIE);
    }
    return response;

  } catch (error) {
    console.error('Registration error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}