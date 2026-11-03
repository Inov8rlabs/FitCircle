import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  EngageConnector,
  EngageConnectorError,
  ConnectorOutbox,
  createRecipientAuthorizer,
  sendNativeTargets,
  type NativeDeliveryTarget,
} from "@inov8r/engage-connector";
import {
  IdSchema,
  TenantSchema,
  type Tenant,
  type NativePolicy,
  type RecipientAuthorization,
} from "@inov8r/engage-protocol";
const categories = [
  "journey",
  "momentum",
  "circle",
  "challenge",
  "social",
  "celebration",
  "coach",
] as const;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Query = Pick<PoolClient, "query">;
/** FitCircle owns business/auth data and a small connector outbox only.
 * There is deliberately no Engage database connection or embedded engine. */
export function createStandaloneFitCircle(options: {
  pool: Pool;
  environment: Tenant["environment"];
  origin: string;
  integration_secret: string;
  authorization_secret: string;
  outbox_key: string;
  cron_secret: string;
  legacy_bridge_enabled: boolean;
  test_user_ids?: string[];
  auth: (request: Request) => Promise<{ user_id: string } | null>;
  fetch?: typeof fetch;
  clock?: () => Date;
}) {
  const tenant = Object.freeze(
    TenantSchema.parse({
      app_id: "fitcircle",
      environment: options.environment,
    }),
  );
  const now = options.clock ?? (() => new Date()),
    testUsers = new Set(
      IdSchema.array()
        .max(100)
        .parse(options.test_user_ids ?? []),
    );
  if (
    [
      options.integration_secret,
      options.authorization_secret,
      options.outbox_key,
      options.cron_secret,
    ].some((v) => Buffer.byteLength(v) < 32) ||
    new Set([
      options.integration_secret,
      options.authorization_secret,
      options.outbox_key,
      options.cron_secret,
    ]).size !== 4
  )
    throw new Error("Use separate strong FitCircle connector credentials");
  const connector = new EngageConnector({
    tenant,
    origin: options.origin,
    secret: options.integration_secret,
    fetch: options.fetch,
    now,
  });
  const outbox = new ConnectorOutbox(
    options.pool,
    connector,
    options.outbox_key,
  );
  const db = {
    scope: [tenant.app_id, tenant.environment] as [string, string],
    query: <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values: unknown[] = [],
    ) => options.pool.query<T>(sql, values),
  };
  async function profile(tx: Query, user: string) {
    const row = (
      await tx.query(
        `select p.id,case when a.email_confirmed_at is not null then a.email else null end as email,p.display_name,p.created_at,p.timezone,p.preferences,n.* from public.profiles p join auth.users a on a.id=p.id left join public.notification_preferences n on n.user_id=p.id where p.id=$1 and to_jsonb(a)->>'deleted_at' is null and coalesce((to_jsonb(a)->>'banned_until')::timestamptz,'-infinity'::timestamptz)<=$2 for share of p`,
        [user, now()],
      )
    ).rows[0];
    if (!row)
      throw new EngageConnectorError(
        "SUBJECT_UNAVAILABLE",
        "FitCircle account is unavailable",
        404,
      );
    return row;
  }
  async function enqueueProfile(tx: Query, user: string) {
    const row = await profile(tx, user),
      p = row.preferences ?? {},
      consent: Record<string, "allowed" | "denied" | "unknown"> = {};
    consent.marketing_email =
      p.notifications === false ||
      p.notifications?.email === false ||
      p.marketingEmails === false
        ? "denied"
        : p.marketingEmails === true
          ? "allowed"
          : "unknown";
    consent.marketing_push =
      p.notifications === false ||
      p.notifications?.push === false ||
      p.marketingPush === false
        ? "denied"
        : p.marketingPush === true
          ? "allowed"
          : "unknown";
    for (const c of categories)
      consent[c] = row[`${c}_enabled`] === false ? "denied" : "allowed";
    const value = {
      user_id: user,
      email: row.email ?? null,
      facts: {
        first_name: row.display_name?.trim().split(/\s+/)[0] ?? null,
        joined_at: new Date(row.created_at).toISOString(),
      },
      timezone: row.timezone || row.quiet_hours_timezone || "UTC",
      is_test: testUsers.has(user),
      initial_consent: consent,
    };
    const fingerprint = hash(JSON.stringify(value));
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `fitcircle:connector-profile:${user}`,
    ]);
    const old = (
      await tx.query(
        "select fingerprint from engage_connector.fitcircle_profiles where user_id=$1",
        [user],
      )
    ).rows[0];
    if (old?.fingerprint === fingerprint) return;
    await outbox.enqueue(tx, "profile", value);
    // Snapshot updates may withdraw, but can never re-grant a known permission.
    for (const [permission, state] of Object.entries(consent))
      if (state === "denied")
        await outbox.enqueue(tx, "consent", {
          user_id: user,
          permission,
          allowed: false,
          evidence: { source: "fitcircle_preferences", text_version: "v1" },
        });
    await tx.query(
      "insert into engage_connector.fitcircle_profiles(user_id,fingerprint) values($1,$2) on conflict(user_id) do update set fingerprint=excluded.fingerprint",
      [user, fingerprint],
    );
  }
  async function syncSubject(user: string) {
    IdSchema.parse(user);
    await outbox.transaction((tx) => enqueueProfile(tx, user));
    await flushUser(user);
  }
  async function flushUser(user: string) {
    await outbox.drain(30, user);
    if (
      (
        await options.pool.query(
          "select 1 from engage_connector.outbox where user_id=$1 and state<>'done' limit 1",
          [user],
        )
      ).rowCount
    )
      throw new EngageConnectorError(
        "SYNC_PENDING",
        "Engage synchronization is pending or needs attention",
        503,
      );
  }
  async function bindInstallation(
    user: string,
    install: string,
    tokenId: string,
  ) {
    [user, install, tokenId].forEach((v) => IdSchema.parse(v));
    await syncSubject(user);
    await outbox.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `fitcircle:connector-binding:${install}`,
      ]);
      const token = (
        await tx.query(
          "select token,platform from public.push_tokens where id=$1 and user_id=$2 and is_active for share",
          [tokenId, user],
        )
      ).rows[0];
      if (!token || !["ios", "android"].includes(token.platform))
        throw new Error("An active owned native token is required");
      const old = (
        await tx.query(
          "select user_id,active from engage_connector.fitcircle_bindings where install_id=$1 for update",
          [install],
        )
      ).rows[0];
      if (old?.active && old.user_id !== user)
        throw new Error("Unbind the previous account first");
      await tx.query(
        "insert into engage_connector.fitcircle_bindings(install_id,user_id,token_id,active) values($1,$2,$3,true) on conflict(install_id) do update set user_id=excluded.user_id,token_id=excluded.token_id,active=true",
        [install, user, tokenId],
      );
      await outbox.enqueue(tx, "device", {
        user_id: user,
        install_id: install,
        platform: token.platform,
        token: token.token,
      });
    });
    await flushUser(user);
  }
  async function unbind(user: string, install: string) {
    IdSchema.parse(install);
    await outbox.transaction(async (tx) => {
      await tx.query(
        "update engage_connector.fitcircle_bindings set active=false where user_id=$1 and install_id=$2",
        [user, install],
      );
      await outbox.enqueue(tx, "unbind", {
        user_id: user,
        install_id: install,
      });
    });
    await flushUser(user);
  }
  async function deleteSubject(user: string) {
    IdSchema.parse(user);
    await outbox.transaction(async (tx) => {
      await outbox.enqueue(tx, "delete", { user_id: user });
      await tx.query(
        "delete from engage_connector.fitcircle_bindings where user_id=$1",
        [user],
      );
      await tx.query(
        "delete from engage_connector.fitcircle_profiles where user_id=$1",
        [user],
      );
    });
    // Durable tombstone immediately blocks the authorization callback. The host
    // account deletion may proceed even if the central erasure needs retry.
    await outbox.drain(30, user);
  }
  async function authorize(
    input: RecipientAuthorization,
    nativeTokenId?: string,
  ): Promise<boolean> {
    if (!options.legacy_bridge_enabled) return false;
    return outbox.transaction(async (tx) => {
      if (
        !(
          await tx.query(
            "select bridge_required from engage_connector.fitcircle_control where singleton",
          )
        ).rows[0]?.bridge_required
      )
        return false;
      if (
        (
          await tx.query(
            "select 1 from engage_connector.subjects where user_id=$1 and deleted",
            [input.user_id],
          )
        ).rowCount
      )
        return false;
      const row = await profile(tx, input.user_id),
        p = row.preferences ?? {};
      if (input.channel === "email") {
        if (
          p.notifications === false ||
          p.notifications?.email === false ||
          !row.email ||
          hash(row.email.trim().toLowerCase()) !== input.target_hash
        )
          return false;
        if (input.category === "marketing" && p.marketingEmails !== true)
          return false;
      } else {
        if (p.notifications === false || p.notifications?.push === false)
          return false;
        if (input.category === "marketing" && p.marketingPush !== true)
          return false;
      }
      if (
        input.category === "lifecycle" &&
        (!input.lifecycle_category ||
          !categories.includes(
            input.lifecycle_category as (typeof categories)[number],
          ) ||
          row[`${input.lifecycle_category}_enabled`] === false)
      )
        return false;
      if (input.channel !== "email") {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: row.quiet_hours_timezone || row.timezone || "UTC",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(now());
        const current = `${parts.find((p) => p.type === "hour")!.value}:${parts.find((p) => p.type === "minute")!.value}`,
          start = row.quiet_hours_start?.slice(0, 5) ?? "22:00",
          end = row.quiet_hours_end?.slice(0, 5) ?? "07:00";
        if (
          start !== end &&
          (start < end
            ? current >= start && current < end
            : current >= start || current < end)
        )
          return false;
      }
      if (input.channel === "push") {
        const token = nativeTokenId
          ? (
              await tx.query(
                "select token,platform from public.push_tokens where id=$1 and user_id=$2 and is_active",
                [nativeTokenId, input.user_id],
              )
            ).rows[0]
          : (
              await tx.query(
                "select p.token,p.platform from engage_connector.fitcircle_bindings b join public.push_tokens p on p.id=b.token_id and p.user_id=b.user_id and p.is_active where b.install_id=$1 and b.user_id=$2 and b.active",
                [input.install_id, input.user_id],
              )
            ).rows[0];
        return (
          !!token &&
          token.platform === input.platform &&
          hash(token.token) === input.target_hash
        );
      }
      return true;
    });
  }
  const authorizeRequest = createRecipientAuthorizer({
    tenant,
    keys: { primary: options.authorization_secret },
    now,
    consume_nonce: (nonce, expiry) => outbox.consumeNonce(nonce, expiry),
    check: authorize,
  });
  async function mirror() {
    return outbox.pullChanges(async (tx, item) => {
      if (item.kind === "deleted") {
        await tx.query(
          "insert into engage_connector.subjects(user_id,deleted) values($1,true) on conflict(user_id) do update set deleted=true",
          [item.user_id],
        );
        await tx.query(
          "delete from engage_connector.fitcircle_bindings where user_id=$1",
          [item.user_id],
        );
        await tx.query(
          "update engage_connector.outbox set state='done',ciphertext=null,lease=null,lease_until=null,finished_at=now() where user_id=$1",
          [item.user_id],
        );
        return;
      }
      // Only an explicit authenticated FitCircle action can turn local consent on.
      // A delayed central change-feed grant cannot undo a newer local withdrawal.
      if (item.payload.allowed !== false) return;
      const permission = String(item.payload.permission);
      if (["marketing_email", "marketing_push"].includes(permission))
        await tx.query(
          "update public.profiles set preferences=coalesce(preferences,'{}')||jsonb_build_object($2::text,false) where id=$1",
          [
            item.user_id,
            permission === "marketing_email"
              ? "marketingEmails"
              : "marketingPush",
          ],
        );
      else if (categories.includes(permission as (typeof categories)[number]))
        await tx.query(
          `insert into public.notification_preferences(user_id,${permission}_enabled) values($1,false) on conflict(user_id) do update set ${permission}_enabled=false,updated_at=now()`,
          [item.user_id],
        );
      else throw new Error("Unsupported central consent permission");
    });
  }
  async function signals() {
    const deadline = Date.now() + 5000;
    let captured = 0,
      failed = 0;
    const rows = (
      await options.pool.query(
        "select user_id,revision,deleted from engage_connector.fitcircle_signals where next_attempt_at<=now() order by next_attempt_at,revision limit 100",
      )
    ).rows;
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      try {
        await outbox.transaction(async (tx) => {
          if (row.deleted) {
            await outbox.enqueue(tx, "delete", { user_id: row.user_id });
            await tx.query(
              "delete from engage_connector.fitcircle_profiles where user_id=$1",
              [row.user_id],
            );
            await tx.query(
              "delete from engage_connector.fitcircle_bindings where user_id=$1",
              [row.user_id],
            );
          } else if (
            !(
              await tx.query(
                "select 1 from engage_connector.subjects where user_id=$1 and deleted",
                [row.user_id],
              )
            ).rowCount
          ) {
            try {
              await enqueueProfile(tx, row.user_id);
            } catch (error) {
              // An unavailable/banned auth account cannot receive. Its next
              // auth change creates a new signal; a ban is not permanent erasure.
              if (
                !(error instanceof EngageConnectorError) ||
                error.code !== "SUBJECT_UNAVAILABLE"
              )
                throw error;
            }
          }
          await tx.query(
            "delete from engage_connector.fitcircle_signals where user_id=$1 and revision=$2",
            [row.user_id, row.revision],
          );
        });
        captured++;
      } catch {
        failed++;
        // Back off a failed identity so it cannot occupy the front of every
        // capture batch. A newer source revision resets this delay atomically.
        await outbox.transaction((tx) =>
          tx.query(
            "update engage_connector.fitcircle_signals set attempts=attempts+1,next_attempt_at=now()+least(3600,power(2,least(attempts+1,11)))*interval '1 second' where user_id=$1 and revision=$2",
            [row.user_id, row.revision],
          ),
        );
      }
    }
    return { captured, failed };
  }
  async function registerCampaign(key: string) {
    IdSchema.parse(key);
    const row = (
      await options.pool.query(
        "select title from public.campaigns where id=$1",
        [key],
      )
    ).rows[0];
    if (!row) throw new Error("Native campaign missing");
    await outbox.transaction((tx) =>
      outbox.enqueue(tx, "source-campaign", {
        source_key: key,
        name: row.title,
        bridge_ready: options.legacy_bridge_enabled,
      }),
    );
    await outbox.drain(100);
  }
  async function patchPreferences(
    user: string,
    patch: Record<string, unknown>,
    notification = false,
  ) {
    const grants = Object.entries(patch).some(
      ([key, value]) =>
        value === true &&
        (notification
          ? categories.some((c) => key === `${c}_enabled`)
          : ["marketingEmails", "marketingPush"].includes(key)),
    );
    // Withdrawals must commit locally during an Engage outage. Grants need a
    // fresh central revision and are never automatically rebased by the outbox.
    if (grants) await syncSubject(user);
    const observed = grants
      ? await connector.json(
          `/api/engage/integration/subject?user_id=${encodeURIComponent(user)}`,
          "GET",
        )
      : { policy_revision: 0 };
    const result = await outbox.transaction(async (tx) => {
      await enqueueProfile(tx, user);
      await tx.query(
        "select set_config('engage_connector.explicit_consent','yes',true)",
      );
      const row = (
        await tx.query(
          "select preferences from public.profiles where id=$1 for update",
          [user],
        )
      ).rows[0];
      if (!row) throw new Error("Account missing");
      let revision = observed.policy_revision;
      if (notification) {
        await tx.query(
          "insert into public.notification_preferences(user_id) values($1) on conflict do nothing",
          [user],
        );
        for (const [key, value] of Object.entries(patch)) {
          if (
            categories.some((c) => key === `${c}_enabled`) &&
            typeof value === "boolean"
          ) {
            await tx.query(
              `update public.notification_preferences set ${key}=$2,updated_at=now() where user_id=$1`,
              [user, value],
            );
            await outbox.enqueue(tx, "consent", {
              user_id: user,
              permission: key.replace("_enabled", ""),
              allowed: value,
              expected_policy_revision: value ? revision : undefined,
              evidence: { source: "fitcircle_settings", text_version: "v1" },
            });
            revision++;
          } else if (
            ["quiet_hours_start", "quiet_hours_end"].includes(key) &&
            (value === null ||
              (typeof value === "string" &&
                /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)))
          )
            await tx.query(
              `update public.notification_preferences set ${key}=$2::time,updated_at=now() where user_id=$1`,
              [user, value],
            );
          else if (
            key === "quiet_hours_timezone" &&
            typeof value === "string"
          ) {
            new Intl.DateTimeFormat("en", { timeZone: value });
            await tx.query(
              "update public.notification_preferences set quiet_hours_timezone=$2,updated_at=now() where user_id=$1",
              [user, value],
            );
          } else throw new Error("Invalid notification preference");
        }
        return (
          await tx.query(
            "select * from public.notification_preferences where user_id=$1",
            [user],
          )
        ).rows[0];
      }
      const current = row.preferences ?? {},
        merged = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (
          ["marketingEmails", "marketingPush"].includes(key) &&
          typeof value === "boolean"
        ) {
          merged[key] = value;
          await outbox.enqueue(tx, "consent", {
            user_id: user,
            permission:
              key === "marketingEmails" ? "marketing_email" : "marketing_push",
            allowed: value,
            expected_policy_revision: value ? revision : undefined,
            evidence: { source: "fitcircle_settings", text_version: "v1" },
          });
          revision++;
        } else if (
          ["notifications", "privacy", "display", "security"].includes(key) &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        )
          merged[key] = {
            ...(typeof current[key] === "object"
              ? current[key]
              : key === "notifications" && current[key] === false
                ? { push: false, email: false }
                : {}),
            ...value,
          };
        else throw new Error("Invalid preference patch");
      }
      // Preserve legacy preference aliases used by existing FitCircle screens.
      if (merged.display?.units && patch.display) {
        if ("unitSystem" in current) merged.unitSystem = merged.display.units;
        if (current.units && typeof current.units === "object")
          merged.units = {
            ...current.units,
            weight: merged.display.units === "imperial" ? "lbs" : "kg",
            height: merged.display.units === "imperial" ? "inches" : "cm",
          };
      }
      for (const [key, twin] of Object.entries({
        profile_visibility: "profileVisibility",
        show_weight: "showWeight",
        show_progress: "showProgress",
        allow_team_invites: "allowTeamInvites",
        allow_challenge_invites: "allowChallengeInvites",
      }))
        if (
          (patch.privacy as Record<string, unknown> | undefined)?.[key] !==
            undefined &&
          current.privacy?.[twin] !== undefined
        )
          merged.privacy[twin] = (patch.privacy as Record<string, unknown>)[
            key
          ];
      await tx.query("update public.profiles set preferences=$2 where id=$1", [
        user,
        JSON.stringify(merged),
      ]);
      return merged;
    });
    await outbox.drain(30, user);
    if (grants) await flushUser(user);
    return result;
  }
  const hostNotifications = {
    sendTargets: async (
      identity: { tenant: Tenant; user_id: string },
      input: NativePolicy,
      targets: NativeDeliveryTarget[],
    ) => {
      if (
        identity.tenant.app_id !== tenant.app_id ||
        identity.tenant.environment !== tenant.environment
      )
        throw new Error("Wrong app");
      if (input.campaign_key) await registerCampaign(input.campaign_key);
      return sendNativeTargets(connector, identity.user_id, input, targets);
    },
    importHistory: (
      identity: { tenant: Tenant; user_id: string },
      items: unknown[],
    ) =>
      connector.json("/api/engage/integration/native/history", "POST", {
        user_id: identity.user_id,
        items,
      }),
  };
  async function maintenance() {
    const captured = await signals(),
      drained = await outbox.drain(),
      changes = await mirror(),
      health = await outbox.health();
    const cursor = String(
      (
        await options.pool.query(
          "select cursor from engage_connector.checkpoints where name='changes'",
        )
      ).rows[0]?.cursor ?? "0",
    );
    const control = (
      await options.pool.query(
        "select bridge_required from engage_connector.fitcircle_control where singleton",
      )
    ).rows[0];
    const dirty = (
      await options.pool.query(
        "select count(*)::int count,min(created_at) oldest from engage_connector.fitcircle_signals",
      )
    ).rows[0];
    const oldest = [...health.map((r) => r.oldest), dirty.oldest]
      .filter(Boolean)
      .map((d) => new Date(d))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    await connector.json("/api/engage/integration/health", "POST", {
      pending: health
        .filter((r) => r.state !== "parked")
        .reduce((sum, r) => sum + Number(r.count), Number(dirty.count)),
      parked: health.find((r) => r.state === "parked")?.count ?? 0,
      oldest_pending_at: oldest?.toISOString() ?? null,
      change_cursor: cursor,
      bridge_required: control?.bridge_required === true,
    });
    await outbox.transaction((tx) =>
      tx.query(
        "delete from engage_connector.outbox where id in(select id from engage_connector.outbox where state='done' and finished_at<now()-interval '30 days' order by id limit 1000)",
      ),
    );
    return { signals: captured, outbox: drained, changes, health };
  }
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/engage/authorize")
      return authorizeRequest(request);
    if (
      url.pathname === "/api/engage/cron/connector" &&
      request.method === "POST"
    ) {
      const actual = Buffer.from(request.headers.get("authorization") ?? ""),
        expected = Buffer.from("Bearer " + options.cron_secret);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return Response.json(
          { error: { code: "UNAUTHENTICATED" } },
          { status: 401 },
        );
      return Response.json(await maintenance(), {
        headers: { "cache-control": "no-store" },
      });
    }
    if (!url.pathname.startsWith("/api/engage/client/"))
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    const identity = await options.auth(request);
    if (!identity)
      return Response.json(
        { error: { code: "UNAUTHENTICATED" } },
        { status: 401 },
      );
    if (
      (url.pathname === "/api/engage/client/session" &&
        request.method === "POST") ||
      (url.pathname === "/api/engage/client/sync" &&
        request.method === "GET") ||
      (url.pathname === "/api/engage/client/permit" &&
        request.method === "POST")
    )
      await syncSubject(identity.user_id);
    if (
      url.pathname === "/api/engage/client/session" &&
      request.method === "DELETE"
    ) {
      const value = await boundedJson(request.clone());
      await unbind(identity.user_id, IdSchema.parse(value.install_id));
    }
    if (
      url.pathname === "/api/engage/client/consent" &&
      request.method === "POST"
    ) {
      const value = await boundedJson(request);
      if (typeof value.allowed !== "boolean")
        throw new Error("Invalid consent");
      if (["marketing_email", "marketing_push"].includes(value.permission))
        await patchPreferences(identity.user_id, {
          [value.permission === "marketing_email"
            ? "marketingEmails"
            : "marketingPush"]: value.allowed,
        });
      else if (categories.includes(value.permission))
        await patchPreferences(
          identity.user_id,
          { [`${value.permission}_enabled`]: value.allowed },
          true,
        );
      else throw new Error("Unknown consent permission");
      await flushUser(identity.user_id);
      return Response.json(
        { ok: true },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return connector.forwardUser(request, identity.user_id);
  }
  return {
    tenant,
    db,
    connector,
    outbox,
    runtime: { now },
    syncSubject,
    bindInstallation,
    deleteSubject,
    authorize,
    handle,
    patchPreferences,
    signals,
    mirror,
    registerCampaign,
    hostNotifications,
    maintenance,
    publicConsent: {
      unsubscribeUrl: async (input: { user_id: string }) =>
        (
          await connector.json(
            `/api/engage/integration/unsubscribe-link?user_id=${encodeURIComponent(input.user_id)}`,
            "GET",
          )
        ).url as string,
    },
  };
}
async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  const chunks: Uint8Array[] = [];
  let size = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Body timeout")), 10000);
  });
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), timeout]);
      if (item.done) break;
      size += item.value.length;
      if (size > 262144) throw new Error("Body exceeds limit");
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export type StandaloneFitCircle = ReturnType<typeof createStandaloneFitCircle>;
