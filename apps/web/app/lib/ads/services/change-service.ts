/**
 * Bid / budget / status changes (docs/ADS_CONSOLE_SPEC.md §8). Every attempt
 * — dry-run, rejected, failed, applied — writes ad_change_log. Writes are gated
 * by APPLE_ADS_WRITE_ENABLED / META_ADS_WRITE_ENABLED (off by default).
 */
import { z } from 'zod';

import { guardrailCaps, reportTimeZone, writeEnabled } from '../config';
import { getConnector } from '../connectors';
import { todayInTz } from '../dates';
import { EXTERNAL_SOURCE } from '../external-changes';
import { evaluateChange } from '../guardrails';
import type { AdsActor } from '../http';
import type { AdChangeLogEntry, AdChangeResult, AdEntityRow } from '../types';
import { AD_CHANNELS } from '../types';

import { db } from './db';
import { AdsSyncService, entityToRow } from './sync-service';

export const changeBodySchema = z.object({
  channel: z.enum(AD_CHANNELS as [string, ...string[]]),
  level: z.enum(['campaign', 'ad_group', 'keyword', 'ad']),
  externalId: z.string().trim().min(1).max(64),
  field: z.enum(['bid', 'daily_budget', 'status']),
  value: z.union([z.number(), z.string().trim().min(1).max(32)]),
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  /** What the editor showed as the current value (stale-overwrite protection). */
  expectedOldValue: z.union([z.number(), z.string(), z.null()]).optional(),
});

export type ChangeBody = z.infer<typeof changeBodySchema>;

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export class AdsChangeService {
  static async loadEntity(channel: string, level: string, externalId: string): Promise<AdEntityRow | null> {
    const { data, error } = await db().from('ad_entities').select('*').eq('channel', channel).eq('level', level).eq('external_id', externalId).maybeSingle();
    if (error) throw new Error(`ad_entities read: ${error.message}`);
    return (data as AdEntityRow | null) ?? null;
  }

  private static async todaySpend(entity: AdEntityRow | null): Promise<number> {
    if (!entity) return 0;
    const { data } = await db()
      .from('ad_metrics_daily')
      .select('spend')
      .eq('channel', entity.channel)
      .eq('level', entity.level)
      .eq('external_id', entity.external_id)
      .eq('date', todayInTz(reportTimeZone()));
    return Math.round(((data ?? []) as Array<{ spend: number | string }>).reduce((s, r) => s + (Number(r.spend) || 0), 0) * 100) / 100;
  }

  private static async log(row: Record<string, unknown>): Promise<string | null> {
    const { data, error } = await db().from('ad_change_log').insert(row).select('id').maybeSingle();
    if (error) console.error('[ads/changes] audit insert failed:', error.message);
    return (data as { id?: string } | null)?.id ?? null;
  }

  static async change(input: unknown, actor: AdsActor, now = new Date()): Promise<AdChangeResult> {
    const body = changeBodySchema.parse(input);
    const channel = body.channel as AdEntityRow['channel'];
    const connector = getConnector(channel);
    const configured = connector?.isConfigured() ?? false;
    const canWrite = writeEnabled(channel);
    const caps = guardrailCaps();

    let entity = await this.loadEntity(channel, body.level, body.externalId);
    let refreshed = false;
    // Freshness (§8.5): re-read from the network when the stored copy is old.
    if (entity && configured && connector) {
      const age = now.getTime() - Date.parse(entity.synced_at);
      if (!(age < caps.freshnessMs)) {
        try {
          const live = await connector.readEntity({
            channel,
            level: entity.level,
            externalId: entity.external_id,
            parentExternalId: entity.parent_external_id,
            campaignExternalId: entity.campaign_external_id,
          });
          if (live) {
            const syncedAt = new Date().toISOString();
            await AdsSyncService.upsertEntities([live], syncedAt);
            entity = { ...entity, ...entityToRow(live, syncedAt) } as AdEntityRow;
            refreshed = true;
          }
        } catch (e: any) {
          console.warn('[ads/changes] re-read failed:', e?.message);
        }
      }
    }

    const guard = evaluateChange({
      entity,
      field: body.field,
      value: body.value,
      expectedOldValue: body.expectedOldValue,
      force: body.force,
      configured,
      writeEnabled: canWrite,
      refreshed,
      now: now.getTime(),
      caps,
    });
    const todaySpend = await this.todaySpend(entity);
    const forced = !!body.force && guard.checks.some((c) => c.rule === 'step_limit' && c.message.includes('forced'));
    const logBase = {
      actor_user_id: actor.userId,
      actor_email: actor.email,
      channel,
      level: body.level,
      external_id: body.externalId,
      campaign_external_id: entity?.campaign_external_id ?? null,
      entity_name: entity?.name ?? null,
      field: body.field,
      old_value: str(guard.oldValue),
      requested_value: str(guard.value),
      forced,
      checks: guard.checks,
    };
    const result = (outcome: AdChangeResult['outcome'], extra: Partial<AdChangeResult> = {}): AdChangeResult => ({
      ok: outcome === 'applied' || (outcome === 'dry_run' && guard.ok),
      outcome,
      code: guard.code,
      message: guard.message,
      checks: guard.checks,
      oldValue: guard.oldValue,
      requestedValue: guard.value,
      newValue: null,
      pctChange: guard.pctChange,
      todaySpend,
      forced,
      logId: null,
      ...extra,
    });

    if (body.dryRun) {
      const logId = await this.log({ ...logBase, outcome: 'dry_run', new_value: null, error: guard.ok ? null : guard.message });
      return result('dry_run', { logId });
    }
    if (!guard.ok || !entity || !connector) {
      const logId = await this.log({ ...logBase, outcome: 'rejected', new_value: null, error: guard.message });
      return result('rejected', { logId });
    }

    try {
      const applied = await connector.applyChange({
        channel,
        level: entity.level,
        externalId: entity.external_id,
        parentExternalId: entity.parent_external_id,
        campaignExternalId: entity.campaign_external_id,
        field: body.field,
        value: guard.value,
        currency: entity.bid_currency ?? 'USD',
      });
      if (applied.entity) await AdsSyncService.upsertEntities([applied.entity], undefined, { detectExternal: false });
      const logId = await this.log({ ...logBase, outcome: 'applied', new_value: str(applied.confirmedValue), error: null });
      return result('applied', { code: null, message: null, newValue: applied.confirmedValue, logId });
    } catch (e: any) {
      const message = String(e?.message ?? e).slice(0, 500);
      const logId = await this.log({ ...logBase, outcome: 'failed', new_value: null, error: message });
      return result('failed', { code: 'apply_failed', message, logId });
    }
  }

  static async list(limit = 100): Promise<AdChangeLogEntry[]> {
    const n = Math.min(Math.max(Math.floor(limit) || 100, 1), 500);
    const { data, error } = await db().from('ad_change_log').select('*').order('created_at', { ascending: false }).limit(n);
    if (error) throw new Error(`ad_change_log read: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, any>>;
    const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (actorIds.length) {
      const { data: profiles } = await db().from('profiles').select('id, display_name, email').in('id', actorIds);
      for (const p of (profiles ?? []) as Array<{ id: string; display_name?: string; email?: string }>) names.set(p.id, p.display_name || p.email || p.id);
    }
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id ?? null,
      actorEmail: r.actor_email ?? null,
      actorName: r.actor_user_id ? (names.get(r.actor_user_id) ?? null) : (r.actor_email ?? null),
      source: (r.checks as { source?: string } | null)?.source === EXTERNAL_SOURCE ? ('external' as const) : ('console' as const),
      channel: r.channel,
      level: r.level,
      externalId: r.external_id,
      campaignExternalId: r.campaign_external_id ?? null,
      entityName: r.entity_name ?? null,
      field: r.field,
      oldValue: r.old_value ?? null,
      newValue: r.new_value ?? null,
      requestedValue: r.requested_value ?? null,
      outcome: r.outcome,
      forced: !!r.forced,
      error: r.error ?? null,
      createdAt: r.created_at,
    }));
  }
}
