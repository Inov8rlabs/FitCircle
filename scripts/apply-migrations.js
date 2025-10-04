const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);

  console.log(`\nApplying migration: ${fileName}...`);

  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
      console.error(`Error in ${fileName}:`, error);
      return false;
    }

    console.log(`✓ Successfully applied ${fileName}`);
    return true;
  } catch (err) {
    console.error(`Exception in ${fileName}:`, err.message);
    return false;
  }
}

async function main() {
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  const migrations = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log('Found migrations:', migrations);

  for (const migration of migrations) {
    const filePath = path.join(migrationsDir, migration);
    await runMigration(filePath);
  }

  console.log('\nDone!');
}

main().catch(console.error);
