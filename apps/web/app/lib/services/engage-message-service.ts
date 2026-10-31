/**
 * Engage messages (docs/ENGAGE_SPEC.md §5, §9, §11): CRUD with optimistic
 * versioning, launch (go-live checklist incl. §15 platform rules), pause /
 * resume, duplicate, device preview and "send test to me".
 */
import { CampaignError, notFound } from '../campaigns/http';
import { campaignUnsubscribeUrl } from '../campaigns/unsubscribe';
import { inputToColumns, messageToInput, rowToMessage, type MessageRow } from '../engage/model';
import { isPlatform } from '../engage/platform';
import { assetIdsOf, mergeOverride, renderContent } from '../engage/render';
import { launchCheck, parseMessageInput, type LaunchCheck } from '../engage/schema';
import type { EngageMessage, EngagePlatform, MessageContent, MessageStatus, RenderedContent } from '../engage/types';
import { createAdminSupabase } from '../supabase-admin';

import { EngageAssetService } from './engage-asset-service';
import { EngageDeliveryService, actionToPush, renderEmailFor, renderPushFor } from './engage-delivery-service';
import { EngageSegmentService } from './engage-segment-service';

type Profile = Record<string, any>;

export class EngageMessageService {
  static async fetchRow(id: string): Promise<MessageRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Message');
    const { data, error } = await createAdminSupabase().from('engage_messages').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Message');
    return data as MessageRow;
  }

  static async list(filter: { channel?: string | null; status?: string | null; campaignId?: string | null } = {}): Promise<EngageMessage[]> {
    let q = createAdminSupabase().from('engage_messages').select('*');
    if (filter.channel) q = q.eq('channel', filter.channel);
    if (filter.campaignId) q = q.eq('campaign_id', filter.campaignId);
    const { data, error } = await q.order('updated_at', { ascending: false });
    if (error) throw error;
    const now = new Date();
    let out = ((data ?? []) as MessageRow[]).map((r) => rowToMessage(r, now));
    if (filter.status) out = out.filter((m) => m.status === (filter.status as MessageStatus));
    else out = out.filter((m) => m.status !== 'archived');
    return out;
  }

  static async get(id: string): Promise<EngageMessage> {
    return rowToMessage(await this.fetchRow(id));
  }

  static async create(body: unknown, userId: string | null): Promise<EngageMessage> {
    const input = parseMessageInput(body);
    const now = new Date().toISOString();
    const { data, error } = await createAdminSupabase()
      .from('engage_messages')
      .insert({
        ...inputToColumns(input as any),
        published: false,
        published_at: null,
        paused_at: null,
        archived_at: null,
        send_completed_at: null,
        preview_user_ids: [],
        created_by: userId,
        updated_by: userId,
        created_at: now,
        updated_at: now,
        version: 1,
      })
      .select('*')
      .single();
    if (error) throw error;
    return rowToMessage(data as MessageRow);
  }

  static async patch(id: string, body: Record<string, any>, userId: string | null): Promise<EngageMessage> {
    const version = body?.version;
    if (!Number.isInteger(version)) throw new CampaignError(400, 'VALIDATION_ERROR', 'version is required');
    const row = await this.fetchRow(id);
    if (row.version !== version) throw conflict(row);
    const { version: _v, ...changes } = body;
    const merged = parseMessageInput({ ...messageToInput(rowToMessage(row)), ...changes });
    if (merged.channel !== row.channel && row.published) {
      throw new CampaignError(409, 'CHANNEL_LOCKED', 'A launched message cannot change channel; duplicate it instead');
    }
    const timingChanged = merged.sendMode !== row.send_mode || merged.sendAt !== row.send_at || merged.localHour !== row.local_hour;
    const { data, error } = await createAdminSupabase()
      .from('engage_messages')
      .update({
        ...inputToColumns(merged as any),
        ...(timingChanged ? { send_completed_at: null } : {}),
        updated_by: userId,
        updated_at: new Date().toISOString(),
        version: row.version + 1,
      })
      .eq('id', id)
      .eq('version', version)
      .select('*');
    if (error) throw error;
    const updated = ((data ?? []) as MessageRow[])[0];
    if (!updated) throw conflict(await this.fetchRow(id));
    return rowToMessage(updated);
  }

  static async setColumns(id: string, columns: Partial<MessageRow>, userId: string | null): Promise<MessageRow> {
    const { data, error } = await createAdminSupabase()
      .from('engage_messages')
      .update({ ...columns, updated_by: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*');
    if (error) throw error;
    const row = ((data ?? []) as MessageRow[])[0];
    if (!row) throw notFound('Message');
    return row;
  }

  static async archive(id: string, userId: string | null): Promise<EngageMessage> {
    await this.fetchRow(id);
    return rowToMessage(await this.setColumns(id, { archived_at: new Date().toISOString() }, userId));
  }

  /** The checklist for a row (resolves assets + segment). */
  static async check(row: MessageRow): Promise<LaunchCheck> {
    const msg = rowToMessage(row);
    const usable = await EngageAssetService.usableIds(assetIdsOf(msg.variants));
    const segmentOk = row.segment_id ? (await EngageSegmentService.filtersOf(row.segment_id)) !== null : true;
    return launchCheck(msg, { assetsOk: (aid) => usable.has(aid), segmentOk });
  }

  static async launch(id: string, userId: string | null): Promise<EngageMessage & { warnings: string[] }> {
    const row = await this.fetchRow(id);
    if (row.archived_at) throw new CampaignError(409, 'ARCHIVED', 'Archived messages cannot be launched');
    const { errors, warnings } = await this.check(row);
    if (errors.length) throw new CampaignError(422, 'INCOMPLETE', 'The message is not ready to launch', { issues: errors, warnings });
    const now = new Date().toISOString();
    const updated = await this.setColumns(id, { published: true, published_at: row.published_at ?? now, paused_at: null }, userId);
    return { ...rowToMessage(updated), warnings };
  }

  static async pause(id: string, userId: string | null): Promise<EngageMessage> {
    const row = await this.fetchRow(id);
    if (!row.published) throw new CampaignError(409, 'NOT_LAUNCHED', 'Only launched messages can be paused');
    return rowToMessage(await this.setColumns(id, { paused_at: row.paused_at ?? new Date().toISOString() }, userId));
  }

  static async resume(id: string, userId: string | null): Promise<EngageMessage> {
    const row = await this.fetchRow(id);
    if (!row.published) throw new CampaignError(409, 'NOT_LAUNCHED', 'Only launched messages can be resumed');
    return rowToMessage(await this.setColumns(id, { paused_at: null }, userId));
  }

  static async duplicate(id: string, userId: string | null): Promise<EngageMessage> {
    const src = rowToMessage(await this.fetchRow(id));
    const input = messageToInput(src);
    return this.create({ ...input, name: `${src.name} (copy)`.slice(0, 120) }, userId);
  }

  /**
   * POST /{id}/preview { onMyDevices?, platform? } — toggles the caller in
   * preview_user_ids, and returns every variant rendered for the platform
   * (override merged, caller's personalisation) for the tool's preview pane.
   */
  static async preview(
    id: string,
    profile: Profile,
    body: { onMyDevices?: boolean; platform?: string | null }
  ): Promise<{ message: EngageMessage; onMyDevices: boolean; platform: EngagePlatform | null; rendered: Array<{ variantId: string; content: unknown }> }> {
    let row = await this.fetchRow(id);
    const ids = new Set(row.preview_user_ids ?? []);
    const on = typeof body.onMyDevices === 'boolean' ? body.onMyDevices : ids.has(profile.id);
    if (on !== ids.has(profile.id)) {
      if (on) ids.add(profile.id);
      else ids.delete(profile.id);
      row = await this.setColumns(id, { preview_user_ids: [...ids] }, profile.id);
    }
    const platform = isPlatform(body.platform) ? body.platform : null;
    return { message: rowToMessage(row), onMyDevices: on, platform, rendered: await this.renderVariants(row, profile, platform) };
  }

  static async renderVariants(row: MessageRow, profile: Profile, platform: EngagePlatform | null): Promise<Array<{ variantId: string; content: unknown }>> {
    const vars = (await EngageDeliveryService.personalVars([profile.id], { campaignId: row.campaign_id })).get(profile.id) ?? {};
    const assets = await EngageAssetService.refs(assetIdsOf(row.variants ?? []));
    return (row.variants ?? []).map((v) => {
      if (row.channel === 'content_card' || row.channel === 'in_app') {
        return { variantId: v.id, content: renderContent(mergeOverride(v, platform) as MessageContent, vars, assets) };
      }
      if (row.channel === 'push') return { variantId: v.id, content: renderPushFor(row, v, platform, vars, assets) };
      return { variantId: v.id, content: renderEmailFor(row, v, null, vars, assets, campaignUnsubscribeUrl(profile.id)) };
    });
  }

  /**
   * POST /{id}/test { variantId?, platform? } — push/email go to the caller
   * now (no caps/dedupe); cards and in-app add the caller to the preview list
   * so the next app open force-shows it.
   */
  static async test(id: string, profile: Profile, body: { variantId?: string | null; platform?: string | null }): Promise<Record<string, unknown>> {
    const row = await this.fetchRow(id);
    const variant = (row.variants ?? []).find((v) => v.id === body.variantId) ?? (row.variants ?? [])[0];
    if (!variant) throw new CampaignError(422, 'NO_VARIANT', 'The message has no variants');
    const platform = isPlatform(body.platform) ? body.platform : null;
    if (row.channel === 'content_card' || row.channel === 'in_app') {
      const out = await this.preview(id, profile, { onMyDevices: true, platform });
      return { channel: row.channel, previewing: true, note: 'Open the app (or pull to refresh) to see it.', rendered: out.rendered.find((r) => r.variantId === variant.id) };
    }
    const vars = (await EngageDeliveryService.personalVars([profile.id], { campaignId: row.campaign_id })).get(profile.id) ?? {};
    const assets = await EngageAssetService.refs(assetIdsOf([variant]));
    if (row.channel === 'push') {
      if (platform === 'web') throw new CampaignError(422, 'PLATFORM_UNSUPPORTED', 'Web push is not supported');
      const push = renderPushFor(row, variant, platform, vars, assets);
      const devices = await EngageDeliveryService.sendTestPush(profile.id, row, variant.id, push, platform);
      return { channel: 'push', sent: devices > 0, devices, title: push.title, body: push.body, screen: actionToPush(push.action).screen };
    }
    let email: string | null = profile.email ?? null;
    if (!email) {
      const { data } = await createAdminSupabase().from('profiles').select('email').eq('id', profile.id).maybeSingle();
      email = (data as any)?.email ?? null;
    }
    if (!email) throw new CampaignError(400, 'NO_EMAIL', 'Your account has no email address');
    const unsubscribe = campaignUnsubscribeUrl(profile.id);
    const rendered = renderEmailFor(row, variant, null, vars, assets, unsubscribe);
    const sent = await EngageDeliveryService.sendEmail(email, { ...rendered, subject: `[Test] ${rendered.subject}` }, unsubscribe);
    return { channel: 'email', sent, to: email, subject: rendered.subject };
  }
}

function conflict(row: MessageRow): CampaignError {
  return new CampaignError(409, 'VERSION_CONFLICT', 'Someone else saved this message. Reload to see their changes.', { current: rowToMessage(row) });
}
