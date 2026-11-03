import {Pool} from 'pg';
import {TenantSchema} from '@inov8r/engage-protocol';
import {createStandaloneFitCircle} from '../app/lib/engage/standalone';
import {importFitCircleHistory} from '../app/lib/engage/history';

/** Default is read-only. --apply writes only the fixed app's private Engage ledger. */
async function main() {
  const args=process.argv.slice(2);
  if (args.some(arg=>arg!=='--apply' && !arg.startsWith('--through='))) throw new Error('Use --through=<ISO timestamp> and optionally --apply');
  const cutoff=args.find(arg=>arg.startsWith('--through='))?.slice(10);
  if (!cutoff || !/^\d{4}-\d{2}-\d{2}T/.test(cutoff) || !process.env.DATABASE_URL) throw new Error('A fixed ISO cutoff and DATABASE_URL are required');
  const tenant=TenantSchema.parse({app_id:'fitcircle',environment:process.env.ENGAGE_ENVIRONMENT});
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
  try {
    const host=createStandaloneFitCircle({pool,environment:tenant.environment,origin:process.env.ENGAGE_SERVICE_ORIGIN??'',integration_secret:process.env.ENGAGE_INTEGRATION_SECRET??'',authorization_secret:process.env.ENGAGE_AUTHORIZATION_SECRET??'',outbox_key:process.env.ENGAGE_CONNECTOR_ENCRYPTION_KEY??'',cron_secret:process.env.ENGAGE_CONNECTOR_CRON_SECRET??'',legacy_bridge_enabled:false,auth:async()=>null});
    const report=await importFitCircleHistory(host,{through:new Date(cutoff),apply:args.includes('--apply')});
    // The signed API records only this fixed app's cap ledger. Keep this report with release evidence.
    console.log(JSON.stringify({...tenant,...report},null,2));
  } finally {await pool.end();}
}
main().catch(()=>{console.error('History import failed. Check the fixed deployment, migrations and source tables. An interrupted import can be rerun with the same cutoff; no personal data or secrets are printed.');process.exitCode=1;});
