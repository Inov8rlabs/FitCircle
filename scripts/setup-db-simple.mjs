import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read credentials from .env.local
const envPath = join(__dirname, '../apps/web/.env.local');
const envContent = readFileSync(envPath, 'utf8');

const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1];
const serviceKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1];

if (!url || !serviceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

// Extract project ref from URL
const projectRef = url.match(/https:\/\/(.*?)\.supabase\.co/)?.[1];

console.log('Project:', projectRef);
console.log('URL:', url);

async function executeSql(sql) {
  const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return response.json();
}

async function checkTablesExist() {
  const sql = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('profiles', 'challenges', 'teams', 'check_ins');
  `;

  try {
    console.log('Checking existing tables...');
    const result = await executeSql(sql);
    console.log('Existing tables:', result);
  } catch (err) {
    console.error('Error checking tables:', err.message);
  }
}

async function runMigration(filePath, name) {
  const sql = readFileSync(filePath, 'utf8');
  console.log(`\nApplying ${name}...`);

  try {
    await executeSql(sql);
    console.log(`✓ Successfully applied ${name}`);
    return true;
  } catch (err) {
    console.error(`✗ Error in ${name}:`, err.message);
    // Continue anyway
    return false;
  }
}

async function main() {
  await checkTablesExist();

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

  console.log('\nChecking tables after migration...');
  await checkTablesExist();

  console.log('\n✓ Done!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
