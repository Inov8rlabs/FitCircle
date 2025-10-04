import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read from .env.local
const envPath = join(__dirname, '../apps/web/.env.local');
const envContent = readFileSync(envPath, 'utf8');
const databaseUrl = envContent.match(/DATABASE_URL=(.*)/)?.[1];

if (!databaseUrl) {
  console.error('DATABASE_URL not found in .env.local');
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

async function runMigration(filePath, name) {
  const sql = readFileSync(filePath, 'utf8');
  console.log(`\nApplying ${name}...`);

  try {
    await client.query(sql);
    console.log(`✓ Successfully applied ${name}`);
    return true;
  } catch (err) {
    console.error(`✗ Error in ${name}:`, err.message);
    return false;
  }
}

async function main() {
  console.log('Connecting to database...');
  await client.connect();
  console.log('Connected!');

  const migrations = [
    '001_initial_schema.sql',
    '002_rls_policies.sql',
    '003_functions_procedures.sql',
    '004_stored_procedures.sql'
  ];

  for (const migration of migrations) {
    const filePath = join(__dirname, '../supabase/migrations', migration);
    await runMigration(filePath, migration);
  }

  await client.end();
  console.log('\n✓ All migrations applied!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
