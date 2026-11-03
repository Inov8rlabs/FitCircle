import type { Pool } from 'pg';
import {
  createEngage,
  EngageDatabase,
  type EngageConfig,
  type SendPayload,
  type Subject,
  type Tx,
} from '@inov8r/engage-server';
import { IdSchema, TenantSchema, type Tenant } from '@inov8r/engage-protocol';
import type { FcmInstallation } from '@inov8r/engage-adapters';

export const FITCIRCLE_APP_ID = 'fitcircle' as const;
const categories = [
  'journey',
  'momentum',
  'circle',
  'challenge',
  'social',
  'celebration',
  'coach',
] as const;

/** Fixed host catalogue. Browser/user headers cannot select a different app. */
export function createFitCircleHost(options: {
  pool: Pool;
  environment: Tenant['environment'];
  auth: EngageConfig['auth'];
  enabled?: boolean;
  sends_enabled?: boolean;
  providers?: EngageConfig['providers'];
  clock?: () => Date;
  test_user_ids?: string[];
  web_push?: EngageConfig['web_push'];
  public_links?: EngageConfig['public_links'];
  provider_webhooks?: EngageConfig['provider_webhooks'];
  legacy_bridge_enabled?: boolean;
}) {
  const tenant = Object.freeze(
    TenantSchema.parse({
      app_id: FITCIRCLE_APP_ID,
      environment: options.environment,
    }),
  );
  const testUsers = new Set(
    IdSchema.array()
      .max(100)
      .parse(options.test_user_ids ?? []),
  );
  const db = new EngageDatabase(options.pool, tenant);
  // Campaigns and legacy senders consult the same authoritative policy.
  async function deliveryPolicy(tx: Tx, subject: Subject, category: string, surface: string, lifecycle_category: string | undefined, now: Date): Promise<{suppress?: string; defer_until?: Date}> {
      if (subject.is_test && !testUsers.has(subject.id))
        return { suppress: 'qa_access_removed' };
      const { rows } = await tx.query(
        `select p.preferences,n.* from public.profiles p
        left join public.notification_preferences n on n.user_id=p.id where p.id=$1 for share of p`,
        [subject.id],
      );
      const row = rows[0];
      if (!row) return { suppress: 'host_account_missing' };
      const prefs = row.preferences ?? {},
        outbound = ['push', 'web_push', 'email'].includes(surface);
      if (!outbound) return {};
      if (surface === 'email') {
        if ((prefs.notifications === false || prefs.notifications?.email === false)) return { suppress: 'host_email_disabled' };
        const verified = await tx.query('select email from auth.users where id=$1 and email_confirmed_at is not null for share', [subject.id]);
        if (!subject.email || verified.rows[0]?.email?.trim().toLowerCase() !== subject.email.trim().toLowerCase()) return { suppress: 'host_email_unverified' };
      }
      if (surface !== 'email' && (prefs.notifications === false || prefs.notifications?.push === false))
        return { suppress: 'host_push_disabled' };
      if (
        category === 'marketing' &&
        surface === 'email' &&
        (prefs.marketingEmails === false ||
          (prefs.notifications === false || prefs.notifications?.email === false))
      )
        return { suppress: 'host_email_disabled' };
      if (
        category === 'marketing' &&
        surface !== 'email' &&
        prefs.marketingPush === false
      )
        return { suppress: 'host_marketing_push_disabled' };
      if (category === 'lifecycle') {
        if (
          !lifecycle_category ||
          !categories.includes(
            lifecycle_category as (typeof categories)[number],
          )
        )
          return { suppress: 'host_category_required' };
        if (row[`${lifecycle_category}_enabled`] === false)
          return { suppress: 'host_category_disabled' };
      }
      if (surface !== 'email') {
        const start = row.quiet_hours_start?.slice(0, 5) ?? '22:00',
          end = row.quiet_hours_end?.slice(0, 5) ?? '07:00';
        try {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: row.quiet_hours_timezone || subject.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).formatToParts(now);
          const current = `${parts.find((x) => x.type === 'hour')!.value}:${parts.find((x) => x.type === 'minute')!.value}`;
          if (
            start !== end &&
            (start < end
              ? current >= start && current < end
              : current >= start || current < end)
          )
            return { defer_until: new Date(now.getTime() + 60_000) };
        } catch {
          return { suppress: 'host_timezone_invalid' };
        }
      }
      return {};
  }
  const config: EngageConfig = {
    db,
    auth: options.auth,
    enabled: options.enabled === true,
    sends_enabled: options.sends_enabled === true,
    providers: options.providers ?? {},
    clock: options.clock,
    web_push: options.web_push,
    public_links: options.public_links,
    provider_webhooks: options.provider_webhooks,
    fields: {
      first_name: { type: 'string' },
      joined_at: { type: 'timestamp' },
    },
    events: {
      food_logged: {
        source: 'server',
        properties: { meal_type: 'string' },
        goal: true,
      },
      workout_logged: {
        source: 'server',
        properties: { workout_type: 'string' },
        goal: true,
      },
      subscription_started: {
        source: 'server',
        properties: { plan: 'string' },
        goal: true,
      },
    },
    screens: {
      dashboard: {},
      food_log: {},
      exercise_log: {},
      streaks: {},
      circles: {},
      challenges: {},
      fitzy_chat: {},
    },
    url_hosts: ['fitcircle.ai', 'www.fitcircle.ai'],
    placements: {
      home_banner: { max_shown: 1, layouts: ['banner', 'card'] },
      home_feed: { max_shown: 3, layouts: ['card', 'banner'] },
    },
    resolve_token: async (userId, installId) => {
      const result = await db.query(
        `select b.token_id from engage.fitcircle_push_bindings b
        join public.push_tokens p on p.id=b.token_id and p.user_id=b.user_id
        where b.app_id=$1 and b.environment=$2 and b.user_id=$3 and b.install_id=$4 and p.is_active=true`,
        [...db.scope, userId, installId],
      );
      return result.rows[0]?.token_id ?? null;
    },
    on_token_invalidated: async (tx, binding) => {
      // Token references are immutable host row IDs, not raw provider credentials.
      await tx.query(
        'update public.push_tokens set is_active=false where id::text=$1 and user_id=$2',
        [binding.token_ref, binding.user_id],
      );
    },
    delivery_policy: (subject, campaign, now, {tx,message}) => deliveryPolicy(tx,subject,campaign.category,message.surface,message.lifecycle_category,now),
    host_notifications: {
      enabled: options.legacy_bridge_enabled === true,
      campaign_exists: async (tx,key) => key===key.toLowerCase() && IdSchema.safeParse(key).success && !!(await tx.query("select 1 from public.campaigns where id=$1 and exists(select 1 from pg_trigger where tgname='engage_guard_campaign_delivery' and tgrelid='public.campaign_deliveries'::regclass and not tgisinternal and tgenabled<>'D')",[key])).rowCount,
      authorize: async (tx,subject,input) => {
        const decision = await deliveryPolicy(tx,subject,input.category,input.channel,input.lifecycle_category,options.clock?.() ?? new Date());
        return decision.suppress ?? (decision.defer_until ? 'host_quiet_hours' : null);
      },
    },
    on_consent_change: async (tx, change) => {
      if (
        !['marketing_email', 'marketing_push', ...categories].includes(
          change.permission,
        )
      )
        throw new Error('Unknown FitCircle consent permission');
      await tx.query("select set_config('engage.explicit_consent','yes',true)");
      // Purpose-specific opt-in never changes a broader master switch.
      if (
        change.permission === 'marketing_email' ||
        change.permission === 'marketing_push'
      ) {
        const key =
          change.permission === 'marketing_email'
            ? 'marketingEmails'
            : 'marketingPush';
        const result = await tx.query(
          `update public.profiles set preferences=coalesce(preferences,'{}'::jsonb)||jsonb_build_object($2::text,$3::boolean) where id=$1`,
          [change.user_id, key, change.allowed],
        );
        if (result.rowCount !== 1) throw new Error('Host account missing');
      } else {
        // Identifier is selected from the static catalogue, never from arbitrary input.
        await tx.query(
          `insert into public.notification_preferences(user_id,${change.permission}_enabled) values($1,$2)
          on conflict(user_id) do update set ${change.permission}_enabled=excluded.${change.permission}_enabled,updated_at=now()`,
          [change.user_id, change.allowed],
        );
      }
      await tx.query("select set_config('engage.explicit_consent','',true)");
    },
  };
  const engine = createEngage(config);
  async function syncSubject(userId: string) {
    IdSchema.parse(userId);
    const { rows } = await db.query(
      `select p.id,a.email,p.display_name,p.created_at,p.timezone,p.preferences,n.*,s.consent as engage_consent from public.profiles p
      left join auth.users a on a.id=p.id and a.email_confirmed_at is not null
      left join public.notification_preferences n on n.user_id=p.id
      left join engage.subjects s on s.app_id=$2 and s.environment=$3 and s.id=p.id where p.id=$1`,
      [userId, ...db.scope],
    );
    const row = rows[0];
    if (!row) throw new Error('Host account missing');
    const consent: Record<string, 'allowed' | 'denied' | 'unknown'> = {},
      initial: typeof consent = {};
    // Existing Engage opt-outs survive profile refresh; only explicit host denials overwrite them.
    if (
      row.preferences?.marketingEmails === false ||
      (row.preferences?.notifications === false || row.preferences?.notifications?.email === false)
    )
      consent.marketing_email = 'denied';
    if (
      row.preferences?.marketingPush === false ||
      (row.preferences?.notifications === false || row.preferences?.notifications?.push === false)
    )
      consent.marketing_push = 'denied';
    if (
      !row.engage_consent?.marketing_email &&
      row.preferences?.marketingEmails === true &&
      consent.marketing_email !== 'denied'
    )
      initial.marketing_email = 'allowed';
    if (
      !row.engage_consent?.marketing_push &&
      row.preferences?.marketingPush === true &&
      consent.marketing_push !== 'denied'
    )
      initial.marketing_push = 'allowed';
    for (const category of categories) {
      if (row[`${category}_enabled`] === false) consent[category] = 'denied';
      else if (!row.engage_consent?.[category]) initial[category] = 'allowed';
    }
    await engine.runtime.upsertSubject({
      id: userId,
      is_test: testUsers.has(userId),
      email: row.email ?? null,
      facts: {
        first_name: row.display_name?.trim().split(/\s+/)[0] ?? null,
        joined_at: new Date(row.created_at).toISOString(),
      },
      timezone: row.timezone || row.quiet_hours_timezone || 'UTC',
      consent,
      initial_consent: initial,
    });
  }
  async function bindInstallation(
    userId: string,
    installId: string,
    tokenId: string,
  ) {
    [userId, installId, tokenId].forEach((value) => IdSchema.parse(value));
    await syncSubject(userId);
    await db.transaction(async (tx) => {
      await tx.query(
        'select id from engage.subjects where app_id=$1 and environment=$2 and id=$3 and deleted_at is null for update',
        [...db.scope, userId],
      );
      const token = await tx.query(
        'select id from public.push_tokens where id=$1 and user_id=$2 and is_active=true for share',
        [tokenId, userId],
      );
      if (!token.rowCount)
        throw new Error('Push token is not owned by this account');
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${db.scope.join(':')}:push-binding:${installId}`,
      ]);
      const binding = await tx.query(
        'select user_id from engage.fitcircle_push_bindings where app_id=$1 and environment=$2 and install_id=$3',
        [...db.scope, installId],
      );
      const old = await tx.query(
        'select user_id,unbound_at from engage.devices where app_id=$1 and environment=$2 and install_id=$3',
        [...db.scope, installId],
      );
      if (
        binding.rows[0]?.user_id !== userId &&
        binding.rows[0] &&
        !old.rows[0]?.unbound_at
      )
        throw new Error(
          'Installation must be unbound before changing accounts',
        );
      if (
        old.rows[0] &&
        old.rows[0].user_id !== userId &&
        !old.rows[0].unbound_at
      )
        throw new Error(
          'Installation must be unbound before changing accounts',
        );
      const result = await tx.query(
        `insert into engage.fitcircle_push_bindings(app_id,environment,install_id,user_id,token_id)
        values($1,$2,$3,$4,$5) on conflict(app_id,environment,install_id) do update set user_id=excluded.user_id,token_id=excluded.token_id`,
        [...db.scope, installId, userId, tokenId],
      );
      return result.rowCount;
    });
  }
  async function resolveInstallation(
    payload: SendPayload,
  ): Promise<FcmInstallation | null> {
    if (
      payload.app_id !== tenant.app_id ||
      payload.environment !== tenant.environment
    )
      return null;
    const { rows } = await db.query(
      `select b.user_id,b.install_id,b.token_id,p.token,p.platform from engage.fitcircle_push_bindings b
      join public.push_tokens p on p.id=b.token_id and p.user_id=b.user_id and p.is_active=true
      join engage.devices d on d.app_id=b.app_id and d.environment=b.environment and d.install_id=b.install_id and d.user_id=b.user_id and d.unbound_at is null
      join engage.subjects s on s.app_id=b.app_id and s.environment=b.environment and s.id=b.user_id and s.deleted_at is null
      where b.app_id=$1 and b.environment=$2 and b.user_id=$3 and b.install_id=$4 and b.token_id=$5 and d.token_ref=$5::text`,
      [...db.scope, payload.user_id, payload.install_id, payload.token_ref],
    );
    const row = rows[0];
    return row && ['ios', 'android'].includes(row.platform)
      ? {
          ...tenant,
          user_id: row.user_id,
          install_id: row.install_id,
          token_ref: row.token_id,
          token: row.token,
          platform: row.platform,
          active: true,
        }
      : null;
  }
  async function deleteSubject(userId: string) {
    await engine.runtime.deleteSubject({ tenant, user_id: userId });
    await db.query(
      'delete from engage.fitcircle_push_bindings where app_id=$1 and environment=$2 and user_id=$3',
      [...db.scope, userId],
    );
  }
  return {
    ...engine,
    tenant,
    db,
    syncSubject,
    bindInstallation,
    resolveInstallation,
    deleteSubject,
  };
}
export type FitCircleEngageHost = ReturnType<typeof createFitCircleHost>;
