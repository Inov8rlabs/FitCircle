import { beforeEach, expect, it, vi } from 'vitest';
const rows = vi.hoisted(() => [
  { user_id: 'user-a', token: 'token-a', is_active: true },
  { user_id: 'user-b', token: 'token-b', is_active: true },
]);
vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      if (table !== 'push_tokens') throw new Error('Unexpected table');
      const filters: Array<(row: (typeof rows)[number]) => boolean> = [];
      let patch: Record<string, unknown>;
      const query = {
        update(value: Record<string, unknown>) {
          patch = value;
          return query;
        },
        eq(key: keyof (typeof rows)[number], value: unknown) {
          filters.push((row) => row[key] === value);
          return query;
        },
        then(resolve: (value: { error: null }) => unknown) {
          for (const row of rows)
            if (filters.every((filter) => filter(row)))
              Object.assign(row, patch);
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return query;
    },
  }),
}));
import { PushService } from '../../services/push-service';
beforeEach(() => {
  for (const row of rows) row.is_active = true;
});
it('cannot deactivate another account token even when its exact token is supplied', async () => {
  await PushService.removeToken('user-a', 'token-b');
  expect(rows.every((row) => row.is_active)).toBe(true);
  await PushService.removeToken('user-a', 'token-a');
  expect(rows[0]!.is_active).toBe(false);
  expect(rows[1]!.is_active).toBe(true);
});
