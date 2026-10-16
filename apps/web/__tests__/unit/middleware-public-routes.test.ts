import { describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));

import { isPublicPath } from '../../middleware';

describe('middleware isPublicPath', () => {
  it.each([
    '/invite/unsubscribe',
    '/invite/unsubscribe/',
    '/i/MAYA7K2',
    '/i/MAYA7K2/og',
    '/join/FITAB12CD',
    '/join/FITAB12CD/og',
    '/.well-known/apple-app-site-association',
    '/register',
    '/',
  ])('%s is public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(['/invite', '/invite/', '/invite/unsubscribe-other', '/inviteX', '/ideas', '/dashboard'])(
    '%s requires sign-in',
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    }
  );
});
