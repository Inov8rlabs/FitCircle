import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:wGQ7!mTzvwMcMUngTK@db.iltcscgbmjbizvyepieo.supabase.co:5432/postgres';

const MIGRATIONS = [
  '039_momentum_system.sql',
  '041_circle_boost.sql',
  '042_workout_logging.sql',
  '043_challenge_templates.sql',
  '043b_seed_challenge_templates.sql',
  '044_enhanced_onboarding.sql',
  '045_share_cards.sql',
  '046_daily_challenges.sql',
  '047_circle_quests.sql',
  '048_push_notifications.sql',
];

async function main() {
  // Restore the file if renamed
  const migDir = path.join(__dirname, '..', 'supabase', 'migrations');
  
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to database');

  for (const migration of MIGRATIONS) {
    // Try both possible filenames
    let filePath = path.join(migDir, migration);
    if (!fs.existsSync(filePath)) {
      // Try the renamed version
      filePath = path.join(migDir, migration.replace('043b_', '043100_'));
    }
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  SKIP ${migration} — file not found`);
      continue;
    }

    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`\n📦 Running ${migration} (${sql.length} chars)...`);
    try {
      await client.query(sql);
      console.log(`✅ ${migration} — SUCCESS`);
    } catch (err: any) {
      console.error(`❌ ${migration} — FAILED: ${err.message}`);
      // Continue on error (some tables may already exist)
    }
  }

  // Verify tables exist
  console.log('\n📋 Verifying tables...');
  const tables = ['push_tokens', 'notification_log', 'notification_preferences', 
                  'challenge_templates', 'daily_challenges', 'circle_quests', 'share_cards'];
  for (const tbl of tables) {
    try {
      const { rows } = await client.query(`SELECT COUNT(*) as count FROM ${tbl}`);
      console.log(`  ✅ ${tbl}: ${rows[0].count} rows`);
    } catch (err: any) {
      console.log(`  ❌ ${tbl}: ${err.message}`);
    }
  }

  await client.end();
  console.log('\nDone!');
}

main().catch(console.error);
