/** Small Supabase helpers for the ads services (service role only). */
import { createAdminSupabase } from '@/lib/supabase-admin';

export type Db = ReturnType<typeof createAdminSupabase>;

export const db = (): Db => createAdminSupabase();

const PAGE = 1000;

/** Read every row of a query, 1000 at a time (`build` must return a fresh query each call). */
export async function selectAll<T>(build: () => any, max = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
