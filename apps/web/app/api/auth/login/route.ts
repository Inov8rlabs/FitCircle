import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { enforceAbuseLimits } from '@/lib/security/abuse-limits';
import { recordSecurityEvent } from '@/lib/security/security-events';
import { authEmailSchema } from '@/lib/validation/auth-email';

// Validation schema
const loginSchema = z.object({
  email: authEmailSchema(),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = loginSchema.parse(body);

    // Shared limits against credential stuffing: 10 / 15 min per IP, 5 / 15 min per account.
    const rateLimitResponse = await enforceAbuseLimits(request, 'login', { email: validatedData.email });
    if (rateLimitResponse) return rateLimitResponse;

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

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email: validatedData.email,
      password: validatedData.password,
    });

    if (error || !data.user || !data.session) {
      // Credential-stuffing signal: the account is stored hashed only.
      await recordSecurityEvent(request, { kind: 'login_failure', result: 'rejected', action: 'login', reason: 'invalid_credentials', email: validatedData.email });
    }

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      );
    }

    if (!data.user || !data.session) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    // Return success response with session
    const response = NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        profile: profile,
      },
      session: data.session,
      message: 'Login successful!'
    });

    // Set secure cookie with session
    response.cookies.set({
      name: 'sb-access-token',
      value: data.session.access_token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    response.cookies.set({
      name: 'sb-refresh-token',
      value: data.session.refresh_token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });

    return response;

  } catch (error) {
    console.error('Login error:', error);

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