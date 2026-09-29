import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MobileAPIService.updateUserProfile / getUserProfileWithStats against a stub of
 * the service-role client. `hasGenderColumn` switches between "migration 088
 * applied" and "not applied yet".
 */
const db = {
  hasGenderColumn: true,
  missingColumnError: { code: 'PGRST204', message: "Could not find the 'gender' column of 'profiles' in the schema cache" } as {
    code: string;
    message: string;
  },
  row: {} as Record<string, any>,
  updates: [] as Array<Record<string, any>>,
};

function profilesTable() {
  return {
    update: (patch: Record<string, any>) => ({
      eq: () => ({
        select: () => ({
          single: async () => {
            db.updates.push(patch);
            if ('gender' in patch && !db.hasGenderColumn) return { data: null, error: db.missingColumnError };
            if (patch.username === 'taken') return { data: null, error: { code: '23505', message: 'duplicate key' } };
            db.row = { ...db.row, ...patch };
            return { data: { ...db.row }, error: null };
          },
        }),
      }),
    }),
    select: () => ({
      eq: () => ({ single: async () => ({ data: { ...db.row }, error: null }) }),
    }),
  };
}

function otherTable() {
  const result = { data: [], count: 0, error: null };
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => (table === 'profiles' ? profilesTable() : otherTable()),
  }),
}));

import { MobileAPIService } from '../mobile-api-service';

const baseRow = { id: 'u1', username: 'ani', display_name: 'Ani', preferences: {}, goals: [], total_points: 0 };

beforeEach(() => {
  db.hasGenderColumn = true;
  db.missingColumnError = {
    code: 'PGRST204',
    message: "Could not find the 'gender' column of 'profiles' in the schema cache",
  };
  db.row = { ...baseRow, gender: null };
  db.updates = [];
});

describe('MobileAPIService.updateUserProfile: gender', () => {
  it('saves gender when the column exists', async () => {
    const row = await MobileAPIService.updateUserProfile('u1', { display_name: 'Ani', gender: 'female' });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ display_name: 'Ani', gender: 'female' });
    expect(row.gender).toBe('female');
  });

  it('migration 088 not applied: saves everything else and does not fail', async () => {
    db.hasGenderColumn = false;
    db.row = { ...baseRow };

    const row = await MobileAPIService.updateUserProfile('u1', { display_name: 'New Name', height_cm: 180, gender: 'male' });

    expect(db.updates).toHaveLength(2);
    expect(db.updates[1]).toMatchObject({ display_name: 'New Name', height_cm: 180 });
    expect('gender' in db.updates[1]).toBe(false);
    expect(row.display_name).toBe('New Name');
    expect('gender' in row).toBe(false);
  });

  it('migration 088 not applied, Postgres flavour of the error (42703)', async () => {
    db.hasGenderColumn = false;
    db.missingColumnError = { code: '42703', message: 'column "gender" of relation "profiles" does not exist' };
    await expect(MobileAPIService.updateUserProfile('u1', { gender: 'male' })).resolves.toBeTruthy();
    expect(db.updates).toHaveLength(2);
  });

  it('does not send gender at all when the client did not (old request shape)', async () => {
    db.hasGenderColumn = false;
    await MobileAPIService.updateUserProfile('u1', { display_name: 'Ani', weight_kg: 74.5 });
    expect(db.updates).toHaveLength(1);
    expect('gender' in db.updates[0]).toBe(false);
  });

  it('other database errors are still thrown, without a retry', async () => {
    await expect(MobileAPIService.updateUserProfile('u1', { username: 'taken', gender: 'male' })).rejects.toMatchObject({
      code: '23505',
    });
    expect(db.updates).toHaveLength(1);
  });
});

describe('MobileAPIService.updateUserProfile: username', () => {
  it('stores what it stored before for letters, digits and underscores', async () => {
    await MobileAPIService.updateUserProfile('u1', { username: 'John_Doe99' });
    expect(db.updates[0].username).toBe('john_doe99');
  });

  it('keeps the periods the register rule allows', async () => {
    await MobileAPIService.updateUserProfile('u1', { username: 'John.Doe' });
    expect(db.updates[0].username).toBe('john.doe');
  });
});

describe('MobileAPIService.getUserProfileWithStats: gender', () => {
  it('returns the stored value', async () => {
    db.row = { ...baseRow, gender: 'non_binary' };
    expect((await MobileAPIService.getUserProfileWithStats('u1')).gender).toBe('non_binary');
  });

  it('never returns a value iOS cannot decode', async () => {
    db.row = { ...baseRow, gender: 'other' };
    expect((await MobileAPIService.getUserProfileWithStats('u1')).gender).toBeNull();
  });

  it('adds no gender key before migration 088', async () => {
    db.row = { ...baseRow };
    const profile = await MobileAPIService.getUserProfileWithStats('u1');
    expect('gender' in profile).toBe(false);
    expect(profile.preferences.privacy.allow_team_invites).toBe(true);
  });
});
