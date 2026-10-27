/**
 * Releases admin service (docs/RELEASES_TRACKER_SPEC.md §6): list + live-now,
 * one release with its history, admin edits (notes, links, commits, manual
 * status) and manual releases (backend/web or anything the stores can't see).
 */
import { z } from 'zod';

import { db, selectAll } from '@/lib/ads/services/db';
import { CampaignError } from '@/lib/campaigns/http';

import { computeLiveNow, rowToEvent, rowToRelease, sortTimeline } from '../model';
import { releaseKey } from '../status';
import { isStoreTrack, LIVE_STATUSES, RELEASE_PLATFORMS, RELEASE_STATUSES, type Release, type ReleaseDetail, type ReleaseStatus, type ReleasesList } from '../types';

import { ReleaseSyncService } from './sync-service';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TRACK = z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'track: lowercase letters, digits, _');

const isoDate = z
  .string()
  .trim()
  .refine((v) => Number.isFinite(Date.parse(v)), 'must be an ISO date/time')
  .transform((v) => new Date(v).toISOString());

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'links must be http(s) URLs');

const commitSchema = z.object({
  sha: z.string().trim().regex(/^[0-9a-f]{4,40}$/i),
  subject: z.string().trim().max(500),
  repo: z.string().trim().max(100).nullish(),
  date: z.string().trim().max(40).nullish(),
});

const editable = {
  internalNotes: z.string().max(20_000).nullish(),
  knownIssues: z.string().max(10_000).nullish(),
  whatsNew: z.string().max(10_000).nullish(),
  links: z.record(z.string().trim().min(1).max(60), httpUrl).refine((l) => Object.keys(l).length <= 30, 'at most 30 links').nullish(),
  commits: z.array(commitSchema).max(300).nullish(),
  migrations: z.array(z.string().trim().min(1).max(120)).max(100).nullish(),
};

export const patchSchema = z
  .object({
    ...editable,
    status: z.enum(RELEASE_STATUSES).nullish(),
    note: z.string().trim().max(1000).nullish(),
    releasedAt: isoDate.nullish(),
  })
  .strict();

export const createSchema = z
  .object({
    platform: z.enum(RELEASE_PLATFORMS),
    track: TRACK,
    version: z.string().trim().min(1).max(40),
    build: z.string().trim().min(1).max(60).nullish(),
    status: z.enum(RELEASE_STATUSES),
    releasedAt: isoDate.nullish(),
    submittedAt: isoDate.nullish(),
    ...editable,
  })
  .strict();

export interface ListFilters {
  platform?: string | null;
  track?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  includeTesting?: boolean;
  limit?: number;
}

export interface Actor {
  email: string | null;
}

const sortAt = (r: Release) => r.releasedAt ?? r.submittedAt ?? r.uploadedAt ?? r.storeCreatedAt ?? r.createdAt;

export class ReleaseService {
  static async all(): Promise<Release[]> {
    const rows = await selectAll<Record<string, any>>(() => db().from('releases').select('*').order('id', { ascending: true }), 20_000);
    return rows.map(rowToRelease);
  }

  static async list(f: ListFilters = {}): Promise<ReleasesList> {
    if (f.platform && !(RELEASE_PLATFORMS as readonly string[]).includes(f.platform)) throw new CampaignError(400, 'VALIDATION_ERROR', `platform must be one of ${RELEASE_PLATFORMS.join(', ')}`);
    if (f.status && !(RELEASE_STATUSES as readonly string[]).includes(f.status)) throw new CampaignError(400, 'VALIDATION_ERROR', 'unknown status');
    if ((f.from && !YMD.test(f.from)) || (f.to && !YMD.test(f.to))) throw new CampaignError(400, 'VALIDATION_ERROR', 'from/to must be YYYY-MM-DD');
    const all = await this.all();
    const limit = Math.min(Math.max(Number(f.limit) || 300, 1), 1000);
    const filtered = all.filter((r) => {
      if (f.platform && r.platform !== f.platform) return false;
      if (f.track && r.track !== f.track) return false;
      if (!f.track && !f.includeTesting && !isStoreTrack(r.track)) return false;
      if (f.status && r.status !== f.status) return false;
      const day = sortAt(r).slice(0, 10);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    });
    return { releases: sortTimeline(filtered).slice(0, limit), liveNow: computeLiveNow(all), sync: await ReleaseSyncService.status() };
  }

  static async get(id: string): Promise<ReleaseDetail> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CampaignError(404, 'NOT_FOUND', 'Release not found');
    const { data, error } = await db().from('releases').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new CampaignError(404, 'NOT_FOUND', 'Release not found');
    const { data: events, error: evErr } = await db().from('release_events').select('*').eq('release_id', id).order('occurred_at', { ascending: false }).limit(500);
    if (evErr) throw new Error(evErr.message);
    return { release: rowToRelease(data), events: (events ?? []).map(rowToEvent) };
  }

  /** Append a status event (+ supersede older live rows of the track when this one goes live). */
  private static async recordStatus(release: { id: string; platform: string; track: string; status: ReleaseStatus | null }, to: ReleaseStatus, at: string, actor: Actor, note: string | null) {
    const supabase = db();
    const { error } = await supabase
      .from('release_events')
      .upsert([{ release_id: release.id, from_status: release.status, to_status: to, store_status: null, occurred_at: at, source: 'manual', actor: actor.email, note }], {
        onConflict: 'release_id,to_status,occurred_at',
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`release_events insert: ${error.message}`);
    if (!(LIVE_STATUSES as readonly string[]).includes(to) || !isStoreTrack(release.track)) return;
    const { data: others } = await supabase.from('releases').select('id, status').eq('platform', release.platform).eq('track', release.track).in('status', [...LIVE_STATUSES]);
    for (const o of (others ?? []) as Array<{ id: string; status: ReleaseStatus }>) {
      if (o.id === release.id) continue;
      await supabase.from('releases').update({ status: 'superseded', superseded_at: at, updated_at: new Date().toISOString() }).eq('id', o.id);
      await supabase
        .from('release_events')
        .upsert([{ release_id: o.id, from_status: o.status, to_status: 'superseded', occurred_at: at, source: 'manual', actor: actor.email, note: 'replaced by a newer release' }], {
          onConflict: 'release_id,to_status,occurred_at',
          ignoreDuplicates: true,
        });
    }
  }

  static async update(id: string, body: unknown, actor: Actor): Promise<ReleaseDetail> {
    const p = patchSchema.parse(body ?? {});
    const current = (await this.get(id)).release;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: now };
    if (p.internalNotes !== undefined) patch.internal_notes = p.internalNotes?.trim() ? p.internalNotes : null;
    if (p.knownIssues !== undefined) patch.known_issues = p.knownIssues?.trim() ? p.knownIssues : null;
    if (p.whatsNew !== undefined) patch.whats_new = p.whatsNew?.trim() ? p.whatsNew : null;
    if (p.links !== undefined) patch.links = p.links ?? {};
    if (p.commits !== undefined) patch.commits = p.commits ?? [];
    if (p.migrations !== undefined) patch.migrations = p.migrations ?? [];
    if (p.releasedAt !== undefined) patch.released_at = p.releasedAt ?? null;
    if (p.internalNotes !== undefined || p.knownIssues !== undefined) {
      patch.notes_updated_by = actor.email;
      patch.notes_updated_at = now;
    }
    const statusChange = p.status && p.status !== current.status ? p.status : null;
    if (statusChange) {
      patch.status = statusChange;
      if ((LIVE_STATUSES as readonly string[]).includes(statusChange) && !current.releasedAt && p.releasedAt === undefined) patch.released_at = now;
      if (statusChange === 'superseded' && !current.supersededAt) patch.superseded_at = now;
    }
    const { error } = await db().from('releases').update(patch).eq('id', id);
    if (error) throw new Error(`releases update: ${error.message}`);
    if (statusChange) await this.recordStatus(current, statusChange, now, actor, p.note ?? null);
    return this.get(id);
  }

  static async create(body: unknown, actor: Actor): Promise<ReleaseDetail> {
    const c = createSchema.parse(body ?? {});
    const key = releaseKey({ platform: c.platform, track: c.track, version: c.version, build: c.build ?? null });
    const supabase = db();
    const { data: dup } = await supabase.from('releases').select('id').eq('release_key', key).maybeSingle();
    if (dup) throw new CampaignError(409, 'DUPLICATE', `Release ${key} already exists`, { id: dup.id });
    const now = new Date().toISOString();
    const live = (LIVE_STATUSES as readonly string[]).includes(c.status);
    const row = {
      release_key: key,
      platform: c.platform,
      track: c.track,
      version: c.version,
      build: c.build ?? null,
      status: c.status,
      whats_new: c.whatsNew ?? null,
      internal_notes: c.internalNotes ?? null,
      known_issues: c.knownIssues ?? null,
      commits: c.commits ?? [],
      migrations: c.migrations ?? [],
      links: c.links ?? {},
      source: 'manual',
      submitted_at: c.submittedAt ?? null,
      released_at: c.releasedAt ?? (live ? now : null),
      notes_updated_by: c.internalNotes ? actor.email : null,
      notes_updated_at: c.internalNotes ? now : null,
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await supabase.from('releases').insert(row).select('id').single();
    if (error || !data) throw new Error(`releases insert: ${error?.message ?? 'no row'}`);
    await this.recordStatus({ id: data.id, platform: c.platform, track: c.track, status: null }, c.status, row.released_at ?? now, actor, 'created in admin');
    return this.get(data.id);
  }
}
