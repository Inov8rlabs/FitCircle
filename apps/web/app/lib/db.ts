import { Pool } from 'pg';

/**
 * Lazily-created singleton Postgres pool for the few queries the Supabase JS client can't
 * express — specifically the pgvector KNN ordering (`ORDER BY embedding <=> $1`), which
 * PostgREST does not expose. Keeping this in TypeScript (raw parameterized SQL) avoids a
 * stored procedure, per the repo's "no stored procedures" rule.
 *
 * Uses DATABASE_URL. On Vercel serverless this MUST be the pooled / pgbouncer connection
 * string (Supabase "Transaction" pooler, port 6543) to avoid exhausting Postgres
 * connections. Returns null when DATABASE_URL is unset so callers can fall back gracefully.
 */
let pool: Pool | null = null;

export function getPgPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
  }
  return pool;
}
