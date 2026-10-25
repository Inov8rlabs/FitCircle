/**
 * Changes made outside the console (the ad network's own UI, another tool):
 * each sync compares the stored entity with the freshly fetched one and logs
 * bid / daily budget / status differences to ad_change_log as applied changes
 * with `checks.source = 'external'` and no actor (the networks don't say who).
 *
 * Console changes re-read the entity after writing and update ad_entities, so
 * the next sync sees no difference and nothing is logged twice. Pure.
 */
import type { AdEntityInput, AdEntityRow } from './types';

export const EXTERNAL_SOURCE = 'external';

type Field = 'bid' | 'daily_budget' | 'status';

const num = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
};

const FIELDS: Array<{ field: Field; prev: (r: AdEntityRow) => string | null; next: (e: AdEntityInput) => string | null }> = [
  { field: 'bid', prev: (r) => num(r.bid_amount), next: (e) => num(e.bidAmount) },
  { field: 'daily_budget', prev: (r) => num(r.daily_budget), next: (e) => num(e.dailyBudget) },
  { field: 'status', prev: (r) => r.status ?? null, next: (e) => e.status ?? null },
];

/** ad_change_log rows for every changed field of an entity seen before. New entities are not changes. */
export function externalChangeRows(previous: AdEntityRow[], fetched: AdEntityInput[]): Record<string, unknown>[] {
  const prev = new Map(previous.map((r) => [`${r.channel}|${r.level}|${r.external_id}`, r]));
  const rows: Record<string, unknown>[] = [];
  for (const e of fetched) {
    const before = prev.get(`${e.channel}|${e.level}|${e.externalId}`);
    if (!before) continue;
    for (const f of FIELDS) {
      const oldValue = f.prev(before);
      const newValue = f.next(e);
      if (oldValue === newValue || newValue === null) continue;
      rows.push({
        actor_user_id: null,
        actor_email: null,
        channel: e.channel,
        level: e.level,
        external_id: e.externalId,
        campaign_external_id: e.campaignExternalId,
        entity_name: e.name,
        field: f.field,
        old_value: oldValue,
        new_value: newValue,
        requested_value: newValue,
        outcome: 'applied',
        forced: false,
        error: null,
        checks: { source: EXTERNAL_SOURCE },
      });
    }
  }
  return rows;
}
