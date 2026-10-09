import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import type * as AnalyticsModule from '@/lib/analytics';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    pathname: '/',
    query: {},
    asPath: '/',
  })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({})),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Mock Next.js headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

// Stub the analytics facade (keeps the generated AnalyticsEvents constructors real)
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();
  return {
    ...actual,
    analytics: {
      init: vi.fn(),
      track: vi.fn(),
      identify: vi.fn(),
      setUserProperties: vi.fn(),
      reset: vi.fn(),
      flush: vi.fn(),
      setOptOut: vi.fn(),
      userId: null,
      hasConsent: false,
    },
  };
});

// Mock Supabase (detailed mock in mock-supabase.ts)
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: vi.fn(),
  createAdminSupabase: vi.fn(),
}));

vi.mock('@/lib/supabase-client', () => ({
  createBrowserSupabase: vi.fn(),
}));
