const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const conn = 'postgresql://postgres.iltcscgbmjbizvyepieo:wGQ7%21mTzvwMcMUngTK@aws-1-us-east-2.pooler.supabase.com:5432/postgres';
const base = path.join(__dirname, '..', 'supabase', 'migrations');
const files = ['046_daily_challenges.sql','047_circle_quests.sql','048_push_notifications.sql'];

(async()=>{
  const c = new Client({connectionString: conn, ssl:{rejectUnauthorized:false}});
  await c.connect();
  console.log('Connected');
  for (const f of files){
    const sql = fs.readFileSync(path.join(base,f),'utf8');
    process.stdout.write(`\n==> ${f} ... `);
    try{ await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); console.log('OK'); }
    catch(e){ await c.query('ROLLBACK'); console.log('FAIL'); console.error(e.message); process.exitCode=1; break; }
  }
  const checks=['daily_challenges','daily_challenge_participants','circle_quests','circle_quest_progress','push_tokens','notification_preferences','notification_log'];
  console.log('\nTable checks:');
  for (const t of checks){ const r=await c.query(`select to_regclass('public.${t}') as name`); console.log(`${t}: ${r.rows[0].name?'present':'missing'}`); }
  await c.end();
})();
