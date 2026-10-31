/**
 * Engage asset library (docs/ENGAGE_SPEC.md §2): content-addressed uploads to
 * the public `engage-assets` bucket (a/{sha256}.{ext}, a/{sha256}@{w}.webp)
 * with a one-year cache-control, dedupe by SHA-256, usage tracking, archive
 * guarded by ASSET_IN_USE.
 */
import { createHash } from 'node:crypto';

import { CampaignError, notFound } from '../campaigns/http';
import { EXT, assetImageInfo } from '../engage/image';
import { computeMessageStatus, rowToAsset, type AssetRow, type MessageRow } from '../engage/model';
import { ASSET_BUCKET, ASSET_CACHE_CONTROL, ASSET_MAX_BYTES, ASSET_MIN_WIDTH } from '../engage/policy';
import { assetIdsOf, toAssetRef } from '../engage/render';
import type { AssetRef, AssetVariant, EngageAsset, MessageStatus } from '../engage/types';
import { createAdminSupabase } from '../supabase-admin';

export interface AssetUsage {
  messageId: string;
  name: string;
  status: MessageStatus;
  channel: string;
}

export interface UploadInput {
  file: Uint8Array;
  fileName?: string | null;
  variants?: Array<{ width?: number | null; bytes: Uint8Array }>;
  meta?: { name?: string; sha256?: string; dominantColor?: string; tags?: string[]; alt?: string | null };
}

const PAGE = 50;
const HEX = /^#[0-9a-fA-F]{6}$/;
const IN_USE_STATUSES: MessageStatus[] = ['live', 'scheduled', 'paused'];

export class EngageAssetService {
  static async fetchRow(id: string): Promise<AssetRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Asset');
    const { data, error } = await createAdminSupabase().from('engage_assets').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Asset');
    return data as AssetRow;
  }

  /** assetId → messages (not archived) whose content references it. */
  static async usageMap(): Promise<Map<string, AssetUsage[]>> {
    const { data, error } = await createAdminSupabase()
      .from('engage_messages')
      .select('id, name, channel, variants, published, paused_at, archived_at, starts_at, ends_at')
      .is('archived_at', null);
    if (error) throw error;
    const out = new Map<string, AssetUsage[]>();
    const now = new Date();
    for (const m of (data ?? []) as MessageRow[]) {
      const status = computeMessageStatus(m, now);
      for (const id of assetIdsOf(m.variants ?? [])) {
        out.set(id, [...(out.get(id) ?? []), { messageId: m.id, name: m.name, status, channel: m.channel }]);
      }
    }
    return out;
  }

  static async list(opts: { q?: string | null; tag?: string | null; cursor?: string | null; limit?: number } = {}): Promise<{ assets: EngageAsset[]; nextCursor: string | null }> {
    const { data, error } = await createAdminSupabase().from('engage_assets').select('*').is('archived_at', null).order('created_at', { ascending: false });
    if (error) throw error;
    const q = opts.q?.trim().toLowerCase();
    let rows = (data ?? []) as AssetRow[];
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.tags ?? []).some((t) => t.toLowerCase().includes(q)));
    if (opts.tag) rows = rows.filter((r) => (r.tags ?? []).includes(opts.tag!));
    if (opts.cursor) rows = rows.filter((r) => r.created_at < opts.cursor!);
    const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 200);
    const page = rows.slice(0, limit);
    const usage = await this.usageMap();
    return {
      assets: page.map((r) => rowToAsset(r, usage.get(r.id)?.length ?? 0)),
      nextCursor: rows.length > limit ? page[page.length - 1].created_at : null,
    };
  }

  static async get(id: string): Promise<EngageAsset & { usage: AssetUsage[] }> {
    const row = await this.fetchRow(id);
    const usage = (await this.usageMap()).get(id) ?? [];
    return { ...rowToAsset(row, usage.length), usage };
  }

  /** Upload (or dedupe) an asset + its WebP variants. */
  static async upload(input: UploadInput, userId: string | null): Promise<{ asset: EngageAsset; deduped: boolean }> {
    const bytes = input.file;
    if (!bytes?.byteLength) throw new CampaignError(400, 'INVALID_FILE', 'File is empty');
    if (bytes.byteLength > ASSET_MAX_BYTES) throw new CampaignError(413, 'FILE_TOO_LARGE', 'Assets must be 10 MB or smaller');
    const info = assetImageInfo(bytes);
    if (!info) throw new CampaignError(415, 'UNSUPPORTED_TYPE', 'Assets must be PNG, JPEG, WebP or GIF');
    if (info.width < ASSET_MIN_WIDTH) throw new CampaignError(422, 'TOO_SMALL', `Assets must be at least ${ASSET_MIN_WIDTH} px wide (got ${info.width})`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (input.meta?.sha256 && input.meta.sha256.toLowerCase() !== sha256) {
      throw new CampaignError(400, 'CHECKSUM_MISMATCH', 'The file does not match the SHA-256 the browser computed');
    }
    const supabase = createAdminSupabase();

    const { data: existing, error: exErr } = await supabase.from('engage_assets').select('*').eq('sha256', sha256).maybeSingle();
    if (exErr) throw exErr;
    if (existing) {
      let row = existing as AssetRow;
      if (row.archived_at) {
        const { data: revived, error } = await supabase
          .from('engage_assets')
          .update({ archived_at: null, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .select('*');
        if (error) throw error;
        row = ((revived ?? []) as AssetRow[])[0] ?? row;
      }
      return { asset: rowToAsset(row), deduped: true };
    }

    const put = async (path: string, body: Uint8Array, contentType: string) => {
      const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, body, { contentType, cacheControl: ASSET_CACHE_CONTROL, upsert: false });
      // Same path = same bytes (content-addressed), so "already exists" is success.
      if (error && !/exist|duplicate/i.test(error.message ?? '')) throw error;
      return supabase.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl;
    };

    const url = await put(`a/${sha256}.${EXT[info.type]}`, bytes, info.mime);
    const variants: AssetVariant[] = [];
    if (!(info.type === 'gif')) {
      for (const v of input.variants ?? []) {
        const vInfo = assetImageInfo(v.bytes);
        if (!vInfo || vInfo.type !== 'webp') throw new CampaignError(415, 'UNSUPPORTED_TYPE', 'Variants must be WebP');
        if (vInfo.width > info.width) throw new CampaignError(422, 'VARIANT_UPSCALED', `Variant ${vInfo.width}px is wider than the original`);
        if (variants.some((x) => x.width === vInfo.width)) continue;
        const vUrl = await put(`a/${sha256}@${vInfo.width}.webp`, v.bytes, 'image/webp');
        variants.push({ width: vInfo.width, url: vUrl, format: 'webp' });
      }
      variants.sort((a, b) => a.width - b.width);
    }

    const now = new Date().toISOString();
    const name = (input.meta?.name || input.fileName || `asset-${sha256.slice(0, 8)}`).slice(0, 200);
    const { data, error } = await supabase
      .from('engage_assets')
      .insert({
        sha256,
        name,
        mime: info.mime,
        width: info.width,
        height: info.height,
        bytes: bytes.byteLength,
        url,
        variants,
        dominant_color: input.meta?.dominantColor && HEX.test(input.meta.dominantColor) ? input.meta.dominantColor : '#1f2937',
        tags: [...new Set((input.meta?.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20),
        alt: input.meta?.alt ?? null,
        created_by: userId,
        created_at: now,
        updated_at: now,
        archived_at: null,
      })
      .select('*')
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        // Lost a race with an identical upload.
        const { data: again } = await supabase.from('engage_assets').select('*').eq('sha256', sha256).maybeSingle();
        if (again) return { asset: rowToAsset(again as AssetRow), deduped: true };
      }
      throw error;
    }
    return { asset: rowToAsset(data as AssetRow), deduped: false };
  }

  static async patch(id: string, body: { name?: string; tags?: string[]; alt?: string | null }): Promise<EngageAsset> {
    await this.fetchRow(id);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
    if (Array.isArray(body.tags)) patch.tags = [...new Set(body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    if (body.alt !== undefined) patch.alt = body.alt ? String(body.alt).slice(0, 300) : null;
    const { data, error } = await createAdminSupabase().from('engage_assets').update(patch).eq('id', id).select('*');
    if (error) throw error;
    return rowToAsset(((data ?? []) as AssetRow[])[0]);
  }

  /** DELETE = archive; 409 ASSET_IN_USE (with the usage list) when a live/scheduled/paused message uses it. */
  static async archive(id: string): Promise<EngageAsset> {
    await this.fetchRow(id);
    const usage = (await this.usageMap()).get(id) ?? [];
    const blocking = usage.filter((u) => IN_USE_STATUSES.includes(u.status));
    if (blocking.length) throw new CampaignError(409, 'ASSET_IN_USE', 'This asset is used by a live message', { usage: blocking });
    const { data, error } = await createAdminSupabase()
      .from('engage_assets')
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*');
    if (error) throw error;
    return rowToAsset(((data ?? []) as AssetRow[])[0]);
  }

  /** id → AssetRef for delivery (archived assets still resolve so live content never breaks). */
  static async refs(ids: string[]): Promise<Map<string, AssetRef>> {
    const out = new Map<string, AssetRef>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return out;
    const { data, error } = await createAdminSupabase().from('engage_assets').select('*').in('id', unique);
    if (error) throw error;
    for (const r of (data ?? []) as AssetRow[]) out.set(r.id, toAssetRef(rowToAsset(r)));
    return out;
  }

  /** ids that exist and aren't archived (launch validation). */
  static async usableIds(ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Set();
    const { data, error } = await createAdminSupabase().from('engage_assets').select('id, archived_at').in('id', unique);
    if (error) throw error;
    return new Set(((data ?? []) as Array<{ id: string; archived_at: string | null }>).filter((r) => !r.archived_at).map((r) => r.id));
  }
}
