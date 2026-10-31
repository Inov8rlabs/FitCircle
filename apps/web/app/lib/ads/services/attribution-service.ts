/**
 * user_attribution writes (docs/ADS_CONSOLE_SPEC.md §4): first touch wins,
 * only an `unknown` row may be upgraded. Two writers: the apps
 * (POST /api/mobile/attribution) and the RevenueCat webhook fallback.
 */
import { attributionFromBody, attributionFromRevenueCat, shouldReplace, type AttributionBody } from '../attribution';
import type { AttributionRow } from '../types';

import { db } from './db';

export interface RecordResult {
  attribution: AttributionRow;
  created: boolean;
  updated: boolean;
}

const PURCHASE_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST / Postgres "column does not exist" (migration 117 not applied yet). */
const isMissingColumn = (e: { code?: string; message?: string }) => e.code === 'PGRST204' || e.code === '42703' || /app_instance_id/.test(e.message ?? '');

function withoutInstanceId(row: AttributionRow): AttributionRow {
  const { app_instance_id: _drop, ...rest } = row;
  return rest;
}

export class AdsAttributionService {
  static async get(userId: string): Promise<AttributionRow | null> {
    const { data, error } = await db().from('user_attribution').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(`user_attribution read: ${error.message}`);
    return (data as AttributionRow | null) ?? null;
  }

  static async record(userId: string, body: AttributionBody, now = new Date()): Promise<RecordResult> {
    const incoming = attributionFromBody(userId, body);
    const existing = await this.get(userId);
    const action = shouldReplace(existing, incoming);
    if (action === 'keep') {
      // First touch stays, but a newly reported app instance id is still stored (GA4 join key).
      if (incoming.app_instance_id && !existing!.app_instance_id) {
        const { error } = await db().from('user_attribution').update({ app_instance_id: incoming.app_instance_id }).eq('user_id', userId);
        if (error) console.warn('[ads/attribution] app_instance_id update failed:', error.message);
        else return { attribution: { ...existing!, app_instance_id: incoming.app_instance_id }, created: false, updated: false };
      }
      return { attribution: existing!, created: false, updated: false };
    }
    let row: AttributionRow = { ...incoming, reported_at: now.toISOString() };
    if (action === 'upgrade') {
      // Guarded on channel so two concurrent upgrades can't both win.
      let { data, error } = await db().from('user_attribution').update(row).eq('user_id', userId).eq('channel', 'unknown').select('*');
      if (error && isMissingColumn(error) && 'app_instance_id' in row) {
        row = withoutInstanceId(row);
        ({ data, error } = await db().from('user_attribution').update(row).eq('user_id', userId).eq('channel', 'unknown').select('*'));
      }
      if (error) throw new Error(`user_attribution update: ${error.message}`);
      const hit = (data ?? [])[0] as AttributionRow | undefined;
      if (hit) return { attribution: hit, created: false, updated: true };
      return { attribution: (await this.get(userId)) ?? existing!, created: false, updated: false };
    }
    let { error } = await db().from('user_attribution').insert(row);
    if (error && isMissingColumn(error) && 'app_instance_id' in row) {
      // Backend deployed before migration 117: keep the attribution, drop the instance id.
      row = withoutInstanceId(row);
      ({ error } = await db().from('user_attribution').insert(row));
    }
    if (error) {
      // Lost a race with another report: first touch (the stored one) wins.
      if (error.code === '23505') return { attribution: (await this.get(userId)) ?? row, created: false, updated: false };
      throw new Error(`user_attribution insert: ${error.message}`);
    }
    return { attribution: row, created: true, updated: false };
  }

  /**
   * RevenueCat fallback: insert only when the user has no row at all. Returns
   * the outcome for logging; never throws (callers run it after the response).
   */
  static async fromRevenueCat(event: Record<string, any>): Promise<'inserted' | 'exists' | 'skipped' | 'error'> {
    try {
      if (!event || !PURCHASE_TYPES.has(String(event.type))) return 'skipped';
      if (String(event.environment ?? '').toUpperCase() !== 'PRODUCTION') return 'skipped';
      if (!UUID_RE.test(String(event.app_user_id ?? ''))) return 'skipped';
      const row = attributionFromRevenueCat(event);
      if (!row) return 'skipped';
      if (await this.get(row.user_id)) return 'exists';
      const { error } = await db().from('user_attribution').insert({ ...row, reported_at: new Date().toISOString() });
      if (error) {
        if (error.code === '23505') return 'exists';
        console.warn('[ads/attribution] revenuecat fallback insert failed:', error.message);
        return 'error';
      }
      return 'inserted';
    } catch (e: any) {
      console.warn('[ads/attribution] revenuecat fallback failed:', e?.message);
      return 'error';
    }
  }
}
