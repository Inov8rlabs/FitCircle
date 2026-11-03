import type {HostNotificationInput} from '@inov8r/engage-server';
import type {FitCircleEngageHost} from './host';
import type {StandaloneFitCircle} from './standalone';
import {isCapExempt,isCapChecked,type NotificationType} from '../services/notification-orchestrator';
import {TRANSACTIONAL_TYPES} from '../services/notification-preferences-service';
interface HistoryRow {
  source:'push_log'|'campaign_email'|'reward_email'; id:string; user_id:string;
  occurred_at:Date; notification_type:string|null; dedupe_key:string|null;
  campaign_id:string|null; delivery_key:string|null;
}

/** Only trusted source rows are read; addresses/titles/bodies never enter the history import. */
export async function importFitCircleHistory(host:FitCircleEngageHost|StandaloneFitCircle,options:{through:Date;apply:boolean;batchSize?:number}) {
  if (host.tenant.app_id!=='fitcircle') throw new Error('History import requires the fixed FitCircle deployment');
  const now=host.runtime.now(),through=options.through,from=new Date(now.getTime()-7*86_400_000);
  if (!Number.isFinite(through.getTime()) || through>now || through<from) throw new Error('History cutoff must be within the preceding seven days');
  const batch=options.batchSize ?? 500;
  if (!Number.isInteger(batch) || batch<1 || batch>1000) throw new Error('History batch must contain 1–1000 rows');
  let cursor:{at:Date;source:string;id:string}|null=null;
  const report={through:through.toISOString(),from:from.toISOString(),dry_run:!options.apply,seen:0,imported:0,deleted_or_missing:0,sources:{push_log:0,campaign_email:0,reward_email:0},coverage:'Recorded account push, campaign email and reward email only. Older welcome/generic email and direct unlogged sends require authoritative provider history or a full cap-window drain after all senders are bridged.'};
  for (;;) {
    const rows:HistoryRow[]=(await host.db.query<HistoryRow>(`with history as (
      select 'push_log'::text source,id,user_id,sent_at as occurred_at,notification_type,data->>'dedupeKey' as dedupe_key,null::uuid campaign_id,null::text delivery_key from public.notification_log where suppressed=false
      union all select 'campaign_email',id,user_id,sent_at,null,null,campaign_id,delivery_key from public.campaign_deliveries where channel='email'
      union all select 'reward_email',id,user_id,emailed_at,null,null,null,null from public.referral_rewards where emailed_at is not null
    ) select * from history where occurred_at>=$1 and occurred_at<=$2 and ($3::timestamptz is null or (occurred_at,source,id)>($3,$4,$5::uuid)) order by occurred_at,source,id limit $6`,[from,through,cursor?.at ?? null,cursor?.source ?? null,cursor?.id ?? null,batch])).rows;
    if (!rows.length) break;
    const grouped=new Map<string,Array<HostNotificationInput & {occurred_at:string;outcome:'unknown'}>>();
    for (const row of rows) {
      report.seen++;report.sources[row.source as keyof typeof report.sources]++;
      const push=row.source==='push_log',type=row.notification_type as NotificationType;
      const item:HostNotificationInput & {occurred_at:string;outcome:'unknown'}={
        key:push ? (row.dedupe_key ? `push:${row.dedupe_key}`:`legacy_history:push:${row.id}`) : row.source==='campaign_email' ? `legacy_campaign:${row.campaign_id}:${row.delivery_key}`:`referral_reward:${row.id}`,
        ...(row.campaign_id ? {campaign_key:row.campaign_id}:{}),
        channel:push?'push':'email',category:push ? (TRANSACTIONAL_TYPES.has(type)?'transactional':type==='campaign'?'marketing':'lifecycle') : row.source==='campaign_email'?'marketing':'lifecycle',
        counts_global:push?!isCapExempt(type):true,respect_global_caps:push?isCapChecked(type):true,
        occurred_at:new Date(row.occurred_at).toISOString(),outcome:'unknown',
      };
      grouped.set(row.user_id,[...(grouped.get(row.user_id) ?? []),item]);
    }
    if (options.apply) for (const [user_id,items] of grouped) {
      const account=await host.db.query('select id from public.profiles where id=$1',[user_id]);
      if (!account.rowCount) {report.deleted_or_missing+=items.length;continue;}
      try {
        await host.syncSubject(user_id);
        report.imported+=(await host.hostNotifications.importHistory({tenant:host.tenant,user_id},items)).imported;
      } catch (error) {
        if (['SUBJECT_UNAVAILABLE','SUBJECT_DELETED'].includes((error as {code?:string}).code??'')) {report.deleted_or_missing+=items.length;continue;}
        throw error;
      }
    }
    const last=rows.at(-1)!;cursor={at:last.occurred_at,source:last.source,id:last.id};
  }
  return report;
}
