import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { sendWelcomeEmail } from '@/lib/email/email-service';
import { registerRateLimiter, getIdentifier, applyRateLimit } from '@/lib/middleware/rate-limit';
import { CLEAR_FC_REF_COOKIE, claimWebInvite, resolveWebInvite } from '@/lib/referrals/web-claim';
import {
  USERNAME_PATTERN,
  USERNAME_RULES_MESSAGE,
  deriveUsernameBase,
  ensureUniqueUsername,
} from '@/lib/services/username-service';

// Validation schema
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  // Optional: derived from the email when the form doesn't collect one.
  username: z.string().trim().regex(USERNAME_PATTERN, USERNAME_RULES_MESSAGE).optional(),
  // Optional invite attribution (docs/REFERRALS_SPEC.md §4 Web). Falls back to the fc_ref cookie.
  ref: z.string().max(32).optional(),
  circle: z.string().max(32).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting (3 registrations per day per IP) to curb automated
    // account creation / signup abuse.
    const identifier = getIdentifier(request);
    const rateLimitResponse = await applyRateLimit(request, registerRateLimiter, identifier);
    if (rateLimitResponse) return rateLimitResponse;

    // Parse and validate request body
    const body = await request.json();
    const validatedData = registerSchema.parse(body);

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

    // Register user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: validatedData.email,
      password: validatedData.password,
      options: {
        data: {
          full_name: validatedData.fullName,
          username,
        }
      }
    });

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      );
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      );
    }

    // Create user profile in database
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        email: validatedData.email,
        full_name: validatedData.fullName,
        username,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      console.error('Profile creation error:', profileError);
      // Don't fail the registration if profile creation fails
      // It can be created later
    }

    // Send welcome email (don't wait for it, send async)
    sendWelcomeEmail({
      to: validatedData.email,
      userName: validatedData.fullName,
    }).catch((error) => {
      // Log error but don't fail registration if email fails
      console.error('Failed to send welcome email:', error);
    });

    // Invite attribution: best-effort, never fails registration.
    const invite = resolveWebInvite(
      { ref: validatedData.ref, circle: validatedData.circle },
      request.headers.get('cookie')
    );
    const referral = invite ? await claimWebInvite(authData.user.id, invite) : null;

    // Return success response
    const response = NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: validatedData.fullName,
      },
      session: authData.session,
      message: 'Registration successful! Check your email for a welcome message.'
    });
    if (referral && (referral.claimed || referral.reason !== 'ERROR')) {
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