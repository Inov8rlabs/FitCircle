/**
 * Campaigns (docs/CAMPAIGNS_SPEC.md): viewer-facing views (§3), the legacy
 * seasonal endpoint (REFERRALS_SPEC §10.4), participation, and the admin
 * CRUD / publish / art / preview operations (§8). Pure rules live in
 * lib/campaigns/{model,view,schema}.ts.
 */
import { CampaignError, notFound } from '../campaigns/http';
import { imageInfo } from '../campaigns/image-size';
import { adminToInput, computePhase, inputToColumns, rowToAdmin, type CampaignRow } from '../campaigns/model';
import { ART_SLOTS, isoDate, parseCampaignInput, publishIssues } from '../campaigns/schema';
import { ART_SLOT_SIZES, type AdminCampaign, type ArtSlot, type CampaignView, type CampaignsResponse } from '../campaigns/types';
import { buildCampaignView, campaignIcon, compareViews } from '../campaigns/view';
import type { IconKey } from '../design/icons';
import { localToday } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { CampaignActivityService } from './campaign-activity-service';

export const ART_BUCKET = 'campaign-art';
export const MAX_ART_BYTES = 8 * 1024 * 1024;
/** Admin status "today" when no client timezone is given. */
export const ADMIN_DEFAULT_TZ = 'America/Los_Angeles';

type Profile = Record<string, any>;

export interface Season {
  key: string;
  title: string;
  /** Legacy emoji for shipped apps (≤ 1.1.x); null for 1.2.0+ (applyIconCompat). */
  emoji: string;
  /** Icon key (design/icons.json). */
  icon: IconKey;
  tagline: string;
  description: string;
  startsAt: string;
  endsAt: string;
  featuredFrom: string;
  circle: { name: string; description: string; type: 'custom' | 'step_count' | 'workout_minutes' | 'weight_loss'; startDate: string; endDate: string };
  accent: string;
}

/** The admin preview date (profiles.preferences.campaignPreview.asOf) — admins only. */
export function previewAsOf(profile: Profile | null | undefined): string | null {
  if (!profile?.is_admin) return null;
  const asOf = profile?.preferences?.campaignPreview?.asOf;
  return typeof asOf === 'string' && isoDate.safeParse(asOf).success ? asOf : null;
}

/** Viewer-local "today" for campaign endpoints (admin asOf wins). */
export function viewerToday(profile: Profile | null | undefined, timezone: string | null | undefined): string {
  return previewAsOf(profile) ?? localToday(timezone);
}

interface Visible {
  row: CampaignRow;
  phase: NonNullable<ReturnType<typeof computePhase>>;
  isPreview: boolean;
}

/** Published + in a phase, or a campaign the viewer is previewing. */
export function visibleFor(rows: CampaignRow[], userId: string | null, today: string): Visible[] {
  const out: Visible[] = [];
  for (const row of rows) {
    if (row.archived_at) continue;
    const natural = computePhase(row, today);
    const previewing = !!userId && (row.preview_user_ids ?? []).includes(userId);
    if (row.published && natural) {
      out.push({ row, phase: natural, isPreview: false });
    } else if (previewing) {
      const phase = natural ?? (today < row.starts_at ? 'teaser' : 'ended');
      out.push({ row, phase, isPreview: true });
    }
  }
  return out;
}

/**
 * The campaign the home screen would lead with (= listForViewer's first view)
 * from already-loaded rows: visibility + phase + ordering only, none of the
 * per-viewer joins (participation, doors, friends) that buildViews adds. The
 * home feed uses this so its context costs no campaign round trips when warm.
 */
export function featuredCampaign(rows: CampaignRow[], userId: string | null, today: string): { slug: string; phase: string } | null {
  const visible = visibleFor(rows, userId, today);
  if (visible.length === 0) return null;
  const top = [...visible].sort((a, b) =>
    compareViews(
      { phase: a.phase, priority: a.row.priority ?? 0, startsAt: a.row.starts_at },
      { phase: b.phase, priority: b.row.priority ?? 0, startsAt: b.row.starts_at }
    )
  )[0];
  return { slug: top.row.slug, phase: top.phase };
}

export class CampaignService {
  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  static async fetchActiveRows(): Promise<CampaignRow[]> {
    const { data, error } = await createAdminSupabase().from('campaigns').select('*').is('archived_at', null);
    if (error) throw error;
    return (data ?? []) as CampaignRow[];
  }

  static async fetchById(id: string): Promise<CampaignRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const { data, error } = await createAdminSupabase().from('campaigns').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return data as CampaignRow;
  }

  /** Build views for `visible` rows with the viewer's participation, doors and friends. */
  static async buildViews(visible: Visible[], userId: string | null, today: string): Promise<CampaignView[]> {
    if (visible.length === 0) return [];
    const supabase = createAdminSupabase();
    const ids = visible.map((v) => v.row.id);

    const participants = new Map<string, { joined: boolean; reminders: boolean }>();
    if (userId) {
      const { data, error } = await supabase
        .from('campaign_participants')
        .select('campaign_id, reminders')
        .eq('user_id', userId)
        .in('campaign_id', ids);
      if (error) throw error;
      for (const p of (data ?? []) as Array<{ campaign_id: string; reminders: boolean }>) {
        participants.set(p.campaign_id, { joined: true, reminders: !!p.reminders });
      }
    }

    const calendars = visible.filter((v) => v.row.template === 'daily_calendar' && v.phase !== 'teaser');
    let opened = new Set<string>();
    let friends: Array<{ userId: string; name: string; avatarUrl: string | null; openedToday: boolean }> = [];
    if (userId && calendars.length > 0) {
      const from = calendars.map((v) => v.row.starts_at).sort()[0];
      const to = calendars.map((v) => (v.row.ends_at < today ? v.row.ends_at : today)).sort().reverse()[0];
      opened = (await CampaignActivityService.showedUpDates([userId], from, to)).get(userId) ?? new Set();
      if (calendars.some((v) => v.phase === 'live')) {
        const people = await CampaignActivityService.friendsOf(userId);
        const showed = await CampaignActivityService.showedUpOn(people.map((p) => p.userId), today);
        friends = people.map((p) => ({ ...p, openedToday: showed.has(p.userId) }));
      }
    }

    const views = visible.map((v) =>
      buildCampaignView(v.row, {
        today,
        phase: v.phase,
        isPreview: v.isPreview,
        participant: participants.get(v.row.id) ?? null,
        openedDates: opened,
        friends,
      })
    );
    const priority = new Map(visible.map((v) => [v.row.id, v.row.priority ?? 0]));
    return views.sort((a, b) =>
      compareViews(
        { phase: a.phase, priority: priority.get(a.id) ?? 0, startsAt: a.startsAt },
        { phase: b.phase, priority: priority.get(b.id) ?? 0, startsAt: b.startsAt }
      )
    );
  }

  /** GET /api/mobile/campaigns */
  static async listForViewer(profile: Profile, timezone: string | null): Promise<CampaignsResponse> {
    const today = viewerToday(profile, timezone);
    const rows = await this.fetchActiveRows();
    const views = await this.buildViews(visibleFor(rows, profile.id, today), profile.id, today);
    return { campaigns: views, homeSlug: views[0]?.slug ?? null };
  }

  /** GET /api/mobile/campaigns/{slug} (404 when not visible to the viewer). */
  static async getForViewer(profile: Profile | null, timezone: string | null, slug: string): Promise<CampaignView> {
    const today = viewerToday(profile, timezone);
    const { data, error } = await createAdminSupabase().from('campaigns').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    const userId = profile?.id ?? null;
    const visible = data ? visibleFor([data as CampaignRow], userId, today) : [];
    if (visible.length === 0) throw notFound();
    const [view] = await this.buildViews(visible, userId, today);
    return view;
  }

  /** POST /api/mobile/campaigns/{slug}/participation */
  static async setParticipation(
    profile: Profile,
    timezone: string | null,
    slug: string,
    body: { joined?: boolean | null; reminders?: boolean | null }
  ): Promise<CampaignView> {
    const view = await this.getForViewer(profile, timezone, slug);
    const supabase = createAdminSupabase();
    const current = view.participant;
    let joined = current.joined;
    let reminders = current.reminders;
    if (typeof body.joined === 'boolean') joined = body.joined;
    if (typeof body.reminders === 'boolean') reminders = body.reminders;
    if (body.reminders === true) joined = true; // reminders imply joined
    if (!joined) reminders = false;

    if (!joined) {
      if (current.joined) {
        const { error } = await supabase.from('campaign_participants').delete().eq('campaign_id', view.id).eq('user_id', profile.id);
        if (error) throw error;
      }
    } else if (!current.joined) {
      const { error } = await supabase.from('campaign_participants').insert({ campaign_id: view.id, user_id: profile.id, reminders });
      if (error && (error as any).code !== '23505') throw error;
      if (error) {
        await supabase.from('campaign_participants').update({ reminders }).eq('campaign_id', view.id).eq('user_id', profile.id);
      }
    } else if (reminders !== current.reminders) {
      const { error } = await supabase.from('campaign_participants').update({ reminders }).eq('campaign_id', view.id).eq('user_id', profile.id);
      if (error) throw error;
    }
    return { ...view, participant: { joined, reminders } };
  }

  /** GET /api/mobile/seasonal — legacy shape built from campaigns with a legacy_season_key. */
  static async seasonalFor(profile: Profile | null, timezone: string | null): Promise<{ current: Season | null; upcoming: Season | null }> {
    const today = viewerToday(profile, timezone);
    const rows = (await this.fetchActiveRows()).filter(
      (r) => r.published && r.template === 'seasonal_circle' && !!r.legacy_season_key
    );
    const seasons = rows.map(toSeason);
    const current =
      seasons
        .filter((s) => s.featuredFrom <= today && today <= s.endsAt)
        .sort((a, b) => a.featuredFrom.localeCompare(b.featuredFrom))[0] ?? null;
    const upcoming = seasons.filter((s) => s.featuredFrom > today).sort((a, b) => a.featuredFrom.localeCompare(b.featuredFrom))[0] ?? null;
    return { current, upcoming };
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  static adminToday(timezone?: string | null): string {
    return localToday(timezone || ADMIN_DEFAULT_TZ);
  }

  static async listAdmin(timezone?: string | null): Promise<AdminCampaign[]> {
    const { data, error } = await createAdminSupabase().from('campaigns').select('*').order('starts_at', { ascending: false });
    if (error) throw error;
    const today = this.adminToday(timezone);
    return ((data ?? []) as CampaignRow[]).map((r) => rowToAdmin(r, today));
  }

  static async getAdmin(id: string, timezone?: string | null): Promise<AdminCampaign> {
    return rowToAdmin(await this.fetchById(id), this.adminToday(timezone));
  }

  static async create(body: unknown, userId: string | null, timezone?: string | null): Promise<AdminCampaign> {
    const input = parseCampaignInput(body);
    const now = new Date().toISOString();
    const { data, error } = await createAdminSupabase()
      .from('campaigns')
      .insert({
        ...inputToColumns(input),
        published: false,
        created_by: userId,
        updated_by: userId,
        created_at: now,
        updated_at: now,
        version: 1,
      })
      .select('*')
      .single();
    if (error) {
      if ((error as any).code === '23505') throw new CampaignError(409, 'SLUG_TAKEN', `Slug "${input.slug}" is already used`);
      throw error;
    }
    return rowToAdmin(data as CampaignRow, this.adminToday(timezone));
  }

  /** PATCH: merge a partial CampaignInput onto the current row; optimistic on `version`. */
  static async patch(id: string, body: Record<string, any>, userId: string | null, timezone?: string | null): Promise<AdminCampaign> {
    const version = body?.version;
    if (!Number.isInteger(version)) throw new CampaignError(400, 'VALIDATION_ERROR', 'version is required');
    const row = await this.fetchById(id);
    if (row.version !== version) throw versionConflict(row, this.adminToday(timezone));
    const current = adminToInput(rowToAdmin(row, this.adminToday(timezone)));
    const { version: _v, ...changes } = body;
    const merged = parseCampaignInput({ ...current, ...changes });
    if (merged.slug !== row.slug && row.published) {
      throw new CampaignError(409, 'SLUG_LOCKED', 'Unpublish the campaign before changing its slug (links use it)');
    }
    const { data, error } = await createAdminSupabase()
      .from('campaigns')
      .update({
        ...inputToColumns(merged, (row.app_store ?? {}) as Record<string, unknown>),
        updated_by: userId,
        updated_at: new Date().toISOString(),
        version: row.version + 1,
      })
      .eq('id', id)
      .eq('version', version)
      .select('*');
    if (error) {
      if ((error as any).code === '23505') throw new CampaignError(409, 'SLUG_TAKEN', `Slug "${merged.slug}" is already used`);
      throw error;
    }
    const updated = ((data ?? []) as CampaignRow[])[0];
    if (!updated) throw versionConflict(await this.fetchById(id), this.adminToday(timezone));
    return rowToAdmin(updated, this.adminToday(timezone));
  }

  /** Server-side column patch (publish state, art, preview, app store) — no version bump. */
  static async patchColumns(id: string, columns: Partial<CampaignRow>, userId: string | null): Promise<CampaignRow> {
    const { data, error } = await createAdminSupabase()
      .from('campaigns')
      .update({ ...columns, updated_by: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*');
    if (error) throw error;
    const row = ((data ?? []) as CampaignRow[])[0];
    if (!row) throw notFound();
    return row;
  }

  static async archive(id: string, userId: string | null, timezone?: string | null): Promise<AdminCampaign> {
    await this.fetchById(id);
    const row = await this.patchColumns(id, { archived_at: new Date().toISOString(), published: false }, userId);
    return rowToAdmin(row, this.adminToday(timezone));
  }

  static async publish(id: string, userId: string | null, opts: { acceptFallbackArt?: boolean } = {}, timezone?: string | null): Promise<AdminCampaign> {
    const row = await this.fetchById(id);
    if (row.archived_at) throw new CampaignError(409, 'ARCHIVED', 'Archived campaigns cannot be published');
    const issues = publishIssues(rowToAdmin(row, this.adminToday(timezone)), opts);
    if (issues.length) throw new CampaignError(422, 'INCOMPLETE', 'The campaign is not ready to publish', { issues });
    const updated = await this.patchColumns(id, { published: true, published_at: row.published_at ?? new Date().toISOString() }, userId);
    return rowToAdmin(updated, this.adminToday(timezone));
  }

  static async unpublish(id: string, userId: string | null, timezone?: string | null): Promise<AdminCampaign> {
    await this.fetchById(id);
    return rowToAdmin(await this.patchColumns(id, { published: false }, userId), this.adminToday(timezone));
  }

  /** POST /{id}/art — validate and store an art slot in the public campaign-art bucket. */
  static async uploadArt(
    id: string,
    slot: string,
    bytes: Uint8Array,
    generated: boolean,
    userId: string | null,
    timezone?: string | null
  ): Promise<AdminCampaign> {
    if (!(ART_SLOTS as readonly string[]).includes(slot)) throw new CampaignError(400, 'INVALID_SLOT', `Unknown art slot "${slot}"`);
    const artSlot = slot as ArtSlot;
    if (bytes.byteLength === 0) throw new CampaignError(400, 'INVALID_FILE', 'File is empty');
    if (bytes.byteLength > MAX_ART_BYTES) throw new CampaignError(413, 'FILE_TOO_LARGE', 'Art must be 8 MB or smaller');
    const info = imageInfo(bytes);
    if (!info) throw new CampaignError(415, 'UNSUPPORTED_TYPE', 'Art must be a PNG or JPEG');
    const want = ART_SLOT_SIZES[artSlot];
    if ((artSlot === 'appStoreCard' || artSlot === 'appStoreDetails') && (info.width !== want.width || info.height !== want.height)) {
      throw new CampaignError(422, 'WRONG_DIMENSIONS', `${artSlot} must be exactly ${want.width}×${want.height} (got ${info.width}×${info.height})`, {
        expected: want,
        actual: { width: info.width, height: info.height },
      });
    }
    const row = await this.fetchById(id);
    const supabase = createAdminSupabase();
    const ext = info.type === 'png' ? 'png' : 'jpg';
    const path = `${id}/${artSlot}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(ART_BUCKET).upload(path, bytes, {
      contentType: info.type === 'png' ? 'image/png' : 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: pub } = supabase.storage.from(ART_BUCKET).getPublicUrl(path);
    const art = {
      ...(row.art ?? {}),
      [artSlot]: { url: pub.publicUrl, width: info.width, height: info.height, generated, updatedAt: new Date().toISOString() },
    };
    return rowToAdmin(await this.patchColumns(id, { art }, userId), this.adminToday(timezone));
  }

  /** POST /{id}/preview — toggle "on my devices" and the caller's preview date. */
  static async setPreview(
    id: string,
    userId: string,
    body: { onMyDevices?: boolean; asOf?: string | null },
    timezone?: string | null
  ): Promise<{ campaign: AdminCampaign; asOf: string | null; onMyDevices: boolean }> {
    if (body.asOf !== undefined && body.asOf !== null && !isoDate.safeParse(body.asOf).success) {
      throw new CampaignError(400, 'VALIDATION_ERROR', 'asOf must be YYYY-MM-DD or null');
    }
    const row = await this.fetchById(id);
    const supabase = createAdminSupabase();
    const ids = new Set(row.preview_user_ids ?? []);
    const on = typeof body.onMyDevices === 'boolean' ? body.onMyDevices : ids.has(userId);
    if (on) ids.add(userId);
    else ids.delete(userId);
    const updated = await this.patchColumns(id, { preview_user_ids: [...ids] }, userId);

    const { data: prof, error } = await supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    const prefs = { ...(((prof as any)?.preferences as Record<string, any>) ?? {}) };
    let asOf: string | null = prefs.campaignPreview?.asOf ?? null;
    if (body.asOf !== undefined) {
      asOf = body.asOf;
      if (asOf) prefs.campaignPreview = { ...(prefs.campaignPreview ?? {}), asOf };
      else delete prefs.campaignPreview;
      const { error: upErr } = await supabase.from('profiles').update({ preferences: prefs }).eq('id', userId);
      if (upErr) throw upErr;
    }
    return { campaign: rowToAdmin(updated, this.adminToday(timezone)), asOf, onMyDevices: on };
  }
}

function versionConflict(row: CampaignRow, today: string): CampaignError {
  return new CampaignError(409, 'VERSION_CONFLICT', 'Someone else saved this campaign. Reload to see their changes.', {
    current: rowToAdmin(row, today),
  });
}

export function toSeason(r: CampaignRow): Season {
  return {
    key: r.legacy_season_key as string,
    title: r.title,
    emoji: r.emoji,
    icon: campaignIcon(r),
    tagline: r.tagline,
    description: r.description,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    featuredFrom: r.featured_from,
    circle: r.circle_template ?? { name: r.title, description: r.description, type: 'custom', startDate: r.starts_at, endDate: r.ends_at },
    accent: r.accent,
  };
}
