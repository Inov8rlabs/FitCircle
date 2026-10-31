/** Engage row ⇄ wire mapping and message status (docs/ENGAGE_SPEC.md §5). */
import type {
  ConversionGoal,
  EngageAsset,
  EngageChannel,
  EngageLayout,
  EngageMessage,
  EngagePlatform,
  EngageSegment,
  FilterCondition,
  InAppTrigger,
  MessageInput,
  MessageStatus,
  MessageVariant,
  Placement,
} from './types';

export interface MessageRow {
  id: string;
  name: string;
  campaign_id: string | null;
  channel: EngageChannel;
  placement: Placement | null;
  layout: EngageLayout | null;
  published: boolean;
  published_at: string | null;
  paused_at: string | null;
  archived_at: string | null;
  variants: MessageVariant<any>[] | null;
  control_weight: number;
  segment_id: string | null;
  audience_filters: FilterCondition[] | null;
  platforms: EngagePlatform[] | null;
  starts_at: string;
  ends_at: string | null;
  send_mode: 'immediate' | 'scheduled' | 'local_time' | null;
  send_at: string | null;
  local_hour: number | null;
  send_completed_at: string | null;
  trigger: InAppTrigger | null;
  max_impressions_per_user: number | null;
  min_hours_between: number | null;
  priority: number;
  respect_global_cap: boolean;
  conversion: ConversionGoal | null;
  preview_user_ids: string[] | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface AssetRow {
  id: string;
  sha256: string;
  name: string;
  mime: EngageAsset['mime'];
  width: number;
  height: number;
  bytes: number;
  url: string;
  variants: EngageAsset['variants'] | null;
  dominant_color: string;
  tags: string[] | null;
  alt: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface SegmentRow {
  id: string;
  name: string;
  description: string;
  filters: FilterCondition[] | null;
  estimated_count: number | null;
  estimated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export function computeMessageStatus(
  m: Pick<MessageRow, 'archived_at' | 'published' | 'paused_at' | 'starts_at' | 'ends_at'>,
  now: Date = new Date()
): MessageStatus {
  if (m.archived_at) return 'archived';
  if (!m.published) return 'draft';
  if (m.ends_at && now.getTime() > new Date(m.ends_at).getTime()) return 'ended';
  if (m.paused_at) return 'paused';
  if (now.getTime() < new Date(m.starts_at).getTime()) return 'scheduled';
  return 'live';
}

export function rowToMessage(row: MessageRow, now: Date = new Date()): EngageMessage {
  return {
    id: row.id,
    name: row.name,
    campaignId: row.campaign_id,
    channel: row.channel,
    placement: row.placement,
    layout: row.layout,
    variants: row.variants ?? [],
    controlWeight: row.control_weight ?? 0,
    segmentId: row.segment_id,
    audienceFilters: row.audience_filters ?? [],
    platforms: row.platforms ?? [],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sendMode: row.send_mode,
    sendAt: row.send_at,
    localHour: row.local_hour,
    trigger: row.trigger,
    maxImpressionsPerUser: row.max_impressions_per_user,
    minHoursBetween: row.min_hours_between,
    priority: row.priority ?? 0,
    respectGlobalCap: row.respect_global_cap !== false,
    conversion: row.conversion,
    status: computeMessageStatus(row, now),
    published: !!row.published,
    pausedAt: row.paused_at,
    previewUserIds: row.preview_user_ids ?? [],
    version: row.version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function messageToInput(m: EngageMessage): MessageInput {
  return {
    name: m.name,
    campaignId: m.campaignId,
    channel: m.channel,
    placement: m.placement,
    layout: m.layout,
    variants: m.variants,
    controlWeight: m.controlWeight,
    segmentId: m.segmentId,
    audienceFilters: m.audienceFilters,
    platforms: m.platforms,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    sendMode: m.sendMode,
    sendAt: m.sendAt,
    localHour: m.localHour,
    trigger: m.trigger,
    maxImpressionsPerUser: m.maxImpressionsPerUser,
    minHoursBetween: m.minHoursBetween,
    priority: m.priority,
    respectGlobalCap: m.respectGlobalCap,
    conversion: m.conversion,
  };
}

export function inputToColumns(i: MessageInput): Partial<MessageRow> {
  return {
    name: i.name,
    campaign_id: i.campaignId,
    channel: i.channel,
    placement: i.channel === 'content_card' ? i.placement : null,
    layout: i.channel === 'content_card' || i.channel === 'in_app' ? i.layout : null,
    variants: i.variants,
    control_weight: i.controlWeight,
    segment_id: i.segmentId,
    audience_filters: i.audienceFilters,
    platforms: [...new Set(i.platforms)],
    starts_at: i.startsAt,
    ends_at: i.endsAt,
    send_mode: i.channel === 'push' || i.channel === 'email' ? i.sendMode : null,
    send_at: i.sendAt,
    local_hour: i.localHour,
    trigger: i.channel === 'in_app' ? i.trigger : null,
    max_impressions_per_user: i.maxImpressionsPerUser,
    min_hours_between: i.minHoursBetween,
    priority: i.priority,
    respect_global_cap: i.respectGlobalCap,
    conversion: i.conversion,
  };
}

export function rowToAsset(row: AssetRow, usageCount?: number): EngageAsset {
  return {
    id: row.id,
    sha256: row.sha256,
    name: row.name,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    url: row.url,
    variants: row.variants ?? [],
    dominantColor: row.dominant_color,
    tags: row.tags ?? [],
    alt: row.alt,
    ...(usageCount !== undefined ? { usageCount } : {}),
    createdAt: row.created_at,
  };
}

export function rowToSegment(row: SegmentRow): EngageSegment {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    filters: row.filters ?? [],
    estimatedCount: row.estimated_count,
    estimatedAt: row.estimated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Live for delivery: published, not paused/archived, inside its window. */
export function isLive(row: MessageRow, now: Date = new Date()): boolean {
  return computeMessageStatus(row, now) === 'live';
}
