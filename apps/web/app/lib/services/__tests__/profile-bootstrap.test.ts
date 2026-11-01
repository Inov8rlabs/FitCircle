import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
let profiles: Row[] = [];
let authUser: Row | null = null;
const inserted: Row[] = [];

function query() {
  const filters: Array<(r: Row) => boolean> = [];
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    ilike: (c: string, v: string) => (filters.push((r) => String(r[c]).toLowerCase() === v.toLowerCase()), q),
    limit: () => q,
    maybeSingle: async () => ({ data: profiles.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
    insert: async (row: Row) => {
      inserted.push(row);
      profiles.push(row);
      return { error: null };
    },
  };
  return q;
}

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => query(),
    auth: { admin: { getUserById: async () => ({ data: { user: authUser }, error: null }) } },
  }),
}));

import { ensureProfileRow } from '../profile-bootstrap';

const ID = 'c7e58844-3de0-4ce1-a97a-d6b351edc7c2';

beforeEach(() => {
  profiles = [];
  inserted.length = 0;
  authUser = {
    id: ID,
    email: 'heman.daswani@gmail.com',
    user_metadata: { name: 'Heman Daswani', username: 'heman.daswani' },
  };
});

describe('ensureProfileRow (web signups have no profile row until web onboarding)', () => {
  it('creates the row from the auth user (signup metadata name + username)', async () => {
    expect(await ensureProfileRow(ID)).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: ID,
      email: 'heman.daswani@gmail.com',
      username: 'heman.daswani',
      display_name: 'Heman Daswani',
      onboarding_completed: false,
    });
  });

  it('is a no-op when the row exists', async () => {
    profiles.push({ id: ID });
    expect(await ensureProfileRow(ID)).toBe(true);
    expect(inserted).toHaveLength(0);
  });

  it('derives a free username when the metadata one is taken, and falls back to it for display_name', async () => {
    profiles.push({ id: 'other', username: 'heman.daswani' });
    authUser = { id: ID, email: 'heman.daswani@gmail.com', user_metadata: { username: 'heman.daswani' } };
    expect(await ensureProfileRow(ID)).toBe(true);
    expect(inserted[0].username).not.toBe('heman.daswani');
    expect(inserted[0].display_name).toBe(inserted[0].username);
  });

  it('returns false (never throws) when the auth user is gone', async () => {
    authUser = null;
    expect(await ensureProfileRow(ID)).toBe(false);
  });
});
