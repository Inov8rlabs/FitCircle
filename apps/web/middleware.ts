import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Build the CORS origin allowlist from NEXT_PUBLIC_APP_URL (+ localhost in dev).
// Replaces the previous wildcard `Access-Control-Allow-Origin: *`, which exposed
// the Bearer-token API surface to any website.
function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      origins.push(new URL(appUrl).origin);
    } catch {
      // Ignore a malformed NEXT_PUBLIC_APP_URL rather than crashing the request.
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }

  return origins;
}

// Public routes that do NOT require authentication.
// Everything else under the app is protected-by-default.
export const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/auth',
  '/join',
  '/i', // personal invite landing pages (/i/CODE)
  '/invite/unsubscribe', // invite-email opt-out; /invite itself stays authed (exact or "/invite/unsubscribe/" prefix only)
  '/.well-known', // apple-app-site-association has no extension, so the matcher doesn't skip it
  '/privacy',
  '/terms',
  '/support',
];

/** Exact match or a "/route/…" sub-path (so '/invite/unsubscribe' never opens '/invite'). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

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


  const { pathname } = request.nextUrl;

  // CORS for API routes — scoped to an allowlist (never '*'). Native mobile
  // clients send no Origin header and aren't subject to CORS, so this does not
  // affect /api/mobile/* consumers; it only constrains browser cross-origin use.
  if (pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    const allowedOrigins = getAllowedOrigins();

    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Access-Control-Max-Age', '86400');
      response.headers.append('Vary', 'Origin');
    }

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: response.headers });
    }
  }

  // API routes are not gated here (each route handles its own auth), so the
  // public GET/POST /api/referrals/unsubscribe needs no publicRoutes entry.
  // the matcher already excludes Next.js internals and static assets.
  if (pathname.startsWith('/api/')) {
    if (user) {
      response.headers.set('x-user-id', user.id);
    }
    return response;
  }

  const isPublicRoute = isPublicPath(pathname);

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
