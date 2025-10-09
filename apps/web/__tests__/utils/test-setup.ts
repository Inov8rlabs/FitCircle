import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

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

// Mock Amplitude analytics
vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  setUserProperty: vi.fn(),
}));

// Mock Supabase (detailed mock in mock-supabase.ts)
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: vi.fn(),
  createAdminSupabase: vi.fn(),
}));

vi.mock('@/lib/supabase-client', () => ({
  createBrowserSupabase: vi.fn(),
}));
