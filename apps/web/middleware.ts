import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired - required for Server Components
  // https://supabase.com/docs/guides/auth/server-side/nextjs
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes that do NOT require authentication.
  // Everything else under the app is protected-by-default.
  const publicRoutes = [
    '/',
    '/login',
    '/register',
    '/join',
    '/privacy',
    '/terms',
  ];

  const { pathname } = request.nextUrl;

  // CORS for API routes
  if (pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Max-Age', '86400');

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: response.headers });
    }
  }

  // API routes are not gated here (each route handles its own auth);
  // the matcher already excludes Next.js internals and static assets.
  if (pathname.startsWith('/api/')) {
    if (user) {
      response.headers.set('x-user-id', user.id);
    }
    return response;
  }

  const isPublicRoute = publicRoutes.some(
    route => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (!isPublicRoute) {
    if (!user) {
      // Redirect unauthenticated users to login, preserving where they
      // were headed so they can be sent back after signing in.
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Add user ID to request headers for use in API routes
    response.headers.set('x-user-id', user.id);
  }

  return response;
}

export const config = {
  matcher: [
    // Match all routes except Next.js internals and static assets.
    // (/api is still matched so CORS/preflight handling runs, but it is
    // not auth-gated inside the middleware.)
    // Static assets and PWA files (manifest.json, sw.js, fonts, etc.) are excluded
    // so protect-by-default never 302-redirects them to /login for logged-out users.
    '/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|json|txt|xml|woff|woff2|map)$).*)',
  ],
};