/** Middleware pass-through when the EU restriction does not apply. */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom's Headers ≠ undici's: NextResponse.next({ request }) rejects it here, so pass-through returns a plain response.
vi.mock('next/server', async (orig) => {
  const a = await orig<any>();
  class TestResponse extends a.NextResponse {
    static next() {
      return new a.NextResponse(null);
    }
  }
  return { ...a, NextResponse: TestResponse };
});
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

import { middleware } from '../../middleware';

const req = (path: string, country: string) => new NextRequest(`https://www.fitcircle.ai${path}`, { headers: { 'x-vercel-ip-country': country } });

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.WEB_EU_SIGNUP_BLOCK;
});
afterEach(() => {
  if (saved === undefined) delete process.env.WEB_EU_SIGNUP_BLOCK;
  else process.env.WEB_EU_SIGNUP_BLOCK = saved;
});

describe('middleware: EU restriction pass-through', () => {
  it('explicitly reopened (WEB_EU_SIGNUP_BLOCK=false): EU visitors reach /register', async () => {
    process.env.WEB_EU_SIGNUP_BLOCK = 'false';
    expect((await middleware(req('/register', 'DE'))).headers.get('location')).toBeNull();
  });
  it('default (unset = on): UK visitors reach /register; EU visitors can still open /login and the deletion page', async () => {
    delete process.env.WEB_EU_SIGNUP_BLOCK;
    expect((await middleware(req('/register', 'GB'))).headers.get('location')).toBeNull();
    expect((await middleware(req('/login', 'DE'))).headers.get('location')).toBeNull();
    expect((await middleware(req('/privacy/delete-account', 'DE'))).headers.get('location')).toBeNull();
    expect((await middleware(req('/register', 'DE'))).headers.get('location')).toContain('/not-available?reason=signup');
  });
});
