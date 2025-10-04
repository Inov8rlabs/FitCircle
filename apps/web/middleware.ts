import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Protected routes that require authentication
const protectedRoutes = [
  '/dashboard',
  '/checkin',
  '/progress',
  '/challenges',
  '/teams',
  '/profile',
  '/settings',
];

// API routes that require authentication
const protectedApiRoutes = [
  '/api/checkins',
  '/api/profile',
  '/api/challenges',
  '/api/teams',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Add CORS headers for API routes
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next();

    // Set CORS headers
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Max-Age', '86400');

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: response.headers });
    }
  }

  // Check if the route is protected
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
  const isProtectedApiRoute = protectedApiRoutes.some(route => pathname.startsWith(route));

  if (isProtectedRoute || isProtectedApiRoute) {
    // Get the auth token from Supabase SSR cookies
    // Supabase SSR uses cookies like: sb-{project-ref}-auth-token
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/(.*?)\.supabase\.co/)?.[1];
    const authCookieName = `sb-${projectRef}-auth-token`;

    const authCookie = request.cookies.get(authCookieName)?.value;

    if (!authCookie) {
      console.log('No auth cookie found:', authCookieName);
      if (isProtectedApiRoute) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      // Redirect to login for protected pages
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // Parse the auth cookie (it's base64-encoded JSON)
    try {
      // Decode base64 to JSON
      const decodedCookie = Buffer.from(authCookie.replace('base64-', ''), 'base64').toString('utf-8');
      const authData = JSON.parse(decodedCookie);
      const accessToken = authData.access_token;

      if (!accessToken) {
        throw new Error('No access token in cookie');
      }

      // Verify the token with Supabase
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

      const { data: { user }, error } = await supabase.auth.getUser(accessToken);

      if (error || !user) {
        console.log('Invalid token:', error?.message);
        if (isProtectedApiRoute) {
          return NextResponse.json(
            { error: 'Invalid session' },
            { status: 401 }
          );
        }
        // Clear invalid cookies and redirect to login
        const response = NextResponse.redirect(new URL('/login', request.url));
        response.cookies.delete(authCookieName);
        return response;
      }

      // Add user ID to request headers for use in API routes
      const response = NextResponse.next();
      response.headers.set('x-user-id', user.id);
      return response;

    } catch (error) {
      console.error('Middleware auth error:', error);

      if (isProtectedApiRoute) {
        return NextResponse.json(
          { error: 'Authentication error' },
          { status: 500 }
        );
      }

      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files and images
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};