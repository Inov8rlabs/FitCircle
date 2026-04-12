const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const conn = 'postgresql://postgres.iltcscgbmjbizvyepieo:wGQ7%21mTzvwMcMUngTK@aws-1-us-east-2.pooler.supabase.com:5432/postgres';
const base = path.join(__dirname, '..', 'supabase', 'migrations');

const files = [
  '038_unified_model.sql',
  '039_momentum_system.sql',
  '041_circle_boost.sql',
  '042_workout_logging.sql',
  '043_challenge_templates.sql',
  '043100_seed_challenge_templates.sql',
  '044_enhanced_onboarding.sql',
  '045_share_cards.sql',
  '046_daily_challenges.sql',
  '047_circle_quests.sql',
  '048_push_notifications.sql',
];

async function run() {
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected');

  for (const file of files) {
    const full = path.join(base, file);
    const sql = fs.readFileSync(full, 'utf8');
    process.stdout.write(`\n==> ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('OK');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('FAIL');
      console.error(String(e.message || e));
      process.exitCode = 1;
      break;
    }
  }

  // Verification snapshot
  const checks = [
    'fitcircles',
    'fitcircle_members',
    'circle_daily_boosts',
    'workout_logs',
    'challenge_templates',
    'daily_challenges',
    'circle_quests',
    'push_tokens',
    'notification_preferences',
    'notification_log',
  ];

  console.log('\nTable checks:');
  for (const t of checks) {
    try {
      const r = await client.query(`select to_regclass('public.${t}') as name`);
      console.log(`${t}: ${r.rows[0].name ? 'present' : 'missing'}`);
    } catch (e) {
      console.log(`${t}: error`);
    }
  }

  await client.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
