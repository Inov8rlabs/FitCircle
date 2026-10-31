/**
 * Engage segments (docs/ENGAGE_SPEC.md §6): CRUD, audience paging and reach
 * estimates (capped at 50k users scanned; beyond that the count is
 * extrapolated and flagged approximate).
 */
import { CampaignError, notFound } from '../campaigns/http';
import {
  PROFILE_COLUMNS,
  filterKeys,
  loadSnapshots,
  matchesFilters,
  type AttributeSnapshot,
  type ProfileLite,
} from '../engage/attributes';
import { rowToSegment, type SegmentRow } from '../engage/model';
import { AUDIENCE_PAGE, ESTIMATE_CAP } from '../engage/policy';
import { segmentInputSchema } from '../engage/schema';
import type { EngageSegment, FilterCondition } from '../engage/types';
import { createAdminSupabase } from '../supabase-admin';

export interface Estimate {
  count: number;
  approximate: boolean;
  scanned: number;
  total: number;
  /** Matching users per active push-token platform (web = no token / web token). */
  byPlatform: { ios: number; android: number; web: number };
}

export interface AudiencePage {
  profiles: ProfileLite[];
  snapshots: Map<string, AttributeSnapshot>;
  /** Profiles in this page that match the filters. */
  matching: ProfileLite[];
}

export class EngageSegmentService {
  static async fetchRow(id: string): Promise<SegmentRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Segment');
    const { data, error } = await createAdminSupabase().from('engage_segments').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || (data as SegmentRow).archived_at) throw notFound('Segment');
    return data as SegmentRow;
  }

  static async list(): Promise<EngageSegment[]> {
    const { data, error } = await createAdminSupabase().from('engage_segments').select('*').is('archived_at', null).order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as SegmentRow[]).map(rowToSegment);
  }

  static async get(id: string): Promise<EngageSegment & { usage: Array<{ messageId: string; name: string }> }> {
    const row = await this.fetchRow(id);
    return { ...rowToSegment(row), usage: await this.usage(id) };
  }

  static async usage(id: string): Promise<Array<{ messageId: string; name: string }>> {
    const { data, error } = await createAdminSupabase().from('engage_messages').select('id, name').eq('segment_id', id).is('archived_at', null);
    if (error) throw error;
    return ((data ?? []) as Array<{ id: string; name: string }>).map((m) => ({ messageId: m.id, name: m.name }));
  }

  static async create(body: unknown, userId: string | null): Promise<EngageSegment> {
    const input = segmentInputSchema.parse(body);
    const now = new Date().toISOString();
    const { data, error } = await createAdminSupabase()
      .from('engage_segments')
      .insert({ ...input, created_by: userId, updated_by: userId, created_at: now, updated_at: now, archived_at: null, estimated_count: null, estimated_at: null })
      .select('*')
      .single();
    if (error) throw error;
    return rowToSegment(data as SegmentRow);
  }

  static async patch(id: string, body: unknown, userId: string | null): Promise<EngageSegment> {
    const row = await this.fetchRow(id);
    const input = segmentInputSchema.parse({ name: row.name, description: row.description, filters: row.filters ?? [], ...(body as object) });
    const { data, error } = await createAdminSupabase()
      .from('engage_segments')
      .update({ ...input, updated_by: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*');
    if (error) throw error;
    return rowToSegment(((data ?? []) as SegmentRow[])[0]);
  }

  /** DELETE = archive; 409 SEGMENT_IN_USE when a non-archived message targets it. */
  static async archive(id: string): Promise<void> {
    await this.fetchRow(id);
    const usage = await this.usage(id);
    if (usage.length) throw new CampaignError(409, 'SEGMENT_IN_USE', 'Messages still target this segment', { usage });
    const { error } = await createAdminSupabase().from('engage_segments').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  /** Filters of a segment (empty for none / missing). */
  static async filtersOf(segmentId: string | null): Promise<FilterCondition[] | null> {
    if (!segmentId) return [];
    const { data, error } = await createAdminSupabase().from('engage_segments').select('filters, archived_at').eq('id', segmentId).maybeSingle();
    if (error) throw error;
    if (!data || (data as SegmentRow).archived_at) return null;
    return ((data as SegmentRow).filters ?? []);
  }

  /**
   * Page through every profile (ordered by id) with snapshots for the keys
   * the filters (and `extraKeys`) need.
   */
  static async *audiencePages(
    filters: FilterCondition[],
    opts: { extraKeys?: string[]; pageSize?: number; maxProfiles?: number; now?: Date } = {}
  ): AsyncGenerator<AudiencePage> {
    const supabase = createAdminSupabase();
    const keys = filterKeys(filters);
    for (const k of opts.extraKeys ?? []) keys.add(k);
    const size = opts.pageSize ?? AUDIENCE_PAGE;
    let scanned = 0;
    for (let from = 0; ; from += size) {
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).order('id', { ascending: true }).range(from, from + size - 1);
      if (error) throw error;
      const profiles = (data ?? []) as ProfileLite[];
      if (profiles.length === 0) return;
      const snapshots = await loadSnapshots(profiles, { keys, now: opts.now });
      const matching = profiles.filter((p) => matchesFilters(snapshots.get(p.id)!, filters));
      yield { profiles, snapshots, matching };
      scanned += profiles.length;
      if (profiles.length < size) return;
      if (opts.maxProfiles && scanned >= opts.maxProfiles) return;
    }
  }

  static async estimate(filters: FilterCondition[], opts: { platforms?: string[]; segmentId?: string | null; persist?: boolean } = {}): Promise<Estimate> {
    let all = filters;
    if (opts.segmentId) {
      const seg = await this.filtersOf(opts.segmentId);
      if (seg === null) throw notFound('Segment');
      all = [...seg, ...filters];
    }
    const supabase = createAdminSupabase();
    const { count: total } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
    let count = 0;
    let scanned = 0;
    const byPlatform = { ios: 0, android: 0, web: 0 };
    const targets = opts.platforms ?? [];
    for await (const page of this.audiencePages(all, { extraKeys: ['platform'], maxProfiles: ESTIMATE_CAP })) {
      scanned += page.profiles.length;
      for (const p of page.matching) {
        const snap = page.snapshots.get(p.id)!;
        const plats = snap.tokenPlatforms.length ? snap.tokenPlatforms : ['web'];
        const reachable = targets.length ? plats.filter((x) => targets.includes(x)) : plats;
        if (targets.length && reachable.length === 0) continue;
        count++;
        for (const x of reachable) byPlatform[x as keyof typeof byPlatform]++;
      }
    }
    const t = total ?? scanned;
    const approximate = scanned < t;
    const scale = approximate && scanned > 0 ? t / scanned : 1;
    const out: Estimate = {
      count: Math.round(count * scale),
      approximate,
      scanned,
      total: t,
      byPlatform: {
        ios: Math.round(byPlatform.ios * scale),
        android: Math.round(byPlatform.android * scale),
        web: Math.round(byPlatform.web * scale),
      },
    };
    if (opts.persist && opts.segmentId) {
      await supabase.from('engage_segments').update({ estimated_count: out.count, estimated_at: new Date().toISOString() }).eq('id', opts.segmentId);
    }
    return out;
  }
}
