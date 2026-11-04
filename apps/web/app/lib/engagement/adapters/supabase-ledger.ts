/**
 * SendLedger over public.engagement_sends (migration 119). The unique key
 * (user_id, message_key, period_key, channel) makes `claim` the idempotency
 * guard: a duplicate insert returns null instead of a second send.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminSupabase } from '../../supabase-admin';
import type { Channel, MessageKey } from '../types';

import type { LedgerClaim, LedgerRow, LedgerStampField, SendLedger } from './types';

type Db = SupabaseClient<any, any, any>;

export const LEDGER_TABLE = 'engagement_sends';

const isUniqueViolation = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '23505' || /duplicate key/i.test(e.message ?? ''));

export class SupabaseSendLedger implements SendLedger {
  constructor(private readonly db: Db = createAdminSupabase() as Db) {}

  async probe(): Promise<boolean> {
    const { error } = await this.db.from(LEDGER_TABLE).select('id', { head: true, count: 'exact' }).limit(1);
    if (error) console.warn('[engagement] ledger unavailable:', error.message);
    return !error;
  }

  async claim(c: LedgerClaim): Promise<string | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from(LEDGER_TABLE)
      .insert({
        user_id: c.userId,
        message_key: c.messageKey,
        period_key: c.periodKey,
        channel: c.channel,
        status: c.status ?? 'pending',
        variant: c.variant || null,
        template_version: c.templateVersion,
        goal_key: c.goalKey,
        meta: c.meta ?? {},
        ...(c.status === 'holdout' ? { sent_at: now } : {}),
      })
      .select('id')
      .single();
    if (isUniqueViolation(error)) return null;
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async complete(
    id: string,
    o: { status: 'sent' | 'failed' | 'suppressed'; providerId?: string | null; meta?: Record<string, string | number | boolean> }
  ): Promise<void> {
    const patch: Record<string, unknown> = { status: o.status };
    if (o.status === 'sent') patch.sent_at = new Date().toISOString();
    if (o.providerId) patch.provider_id = o.providerId;
    if (o.meta) {
      const { data } = await this.db.from(LEDGER_TABLE).select('meta').eq('id', id).maybeSingle();
      patch.meta = { ...(((data as any)?.meta as Record<string, unknown>) ?? {}), ...o.meta };
    }
    const { error } = await this.db.from(LEDGER_TABLE).update(patch).eq('id', id);
    if (error) console.error('[engagement] ledger complete failed:', id, error.message);
  }

  async release(id: string): Promise<void> {
    const { error } = await this.db.from(LEDGER_TABLE).delete().eq('id', id).eq('status', 'pending');
    if (error) console.error('[engagement] ledger release failed:', id, error.message);
  }

  async recentForUser(userId: string, sinceIso: string): Promise<LedgerRow[]> {
    const { data, error } = await this.db
      .from(LEDGER_TABLE)
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as LedgerRow[];
  }

  async stamp(
    ref: { providerId?: string | null; sendId?: string | null },
    field: LedgerStampField,
    at: string,
    meta?: Record<string, string>
  ): Promise<LedgerRow | null> {
    let q = this.db.from(LEDGER_TABLE).select('*');
    // Our send id (Resend tag) first: a webhook can beat the provider_id write by a few ms.
    if (ref.sendId && /^[0-9a-f-]{36}$/i.test(ref.sendId)) q = q.eq('id', ref.sendId);
    else if (ref.providerId) q = q.eq('provider_id', ref.providerId);
    else return null;
    const { data: row, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const patch: Record<string, unknown> = { [field]: at };
    if (meta) patch.meta = { ...(((row as any).meta as Record<string, unknown>) ?? {}), ...meta };
    const { data: updated, error: upErr } = await this.db
      .from(LEDGER_TABLE)
      .update(patch)
      .eq('id', (row as any).id)
      .is(field, null)
      .select('*');
    if (upErr) throw upErr;
    return ((updated ?? []) as LedgerRow[])[0] ?? null;
  }

  async exists(userId: string, messageKey: MessageKey, periodKey: string, channel: Channel): Promise<boolean> {
    const { count, error } = await this.db
      .from(LEDGER_TABLE)
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', userId)
      .eq('message_key', messageKey)
      .eq('period_key', periodKey)
      .eq('channel', channel);
    if (error) throw error;
    return (count ?? 0) > 0;
  }
}
