/**
 * Campaign shapes shared by the backend, the admin portal, the web app and
 * (as a reference for their Codable/serializable models) iOS and Android.
 * Contract: docs/CAMPAIGNS_SPEC.md.
 *
 * Icons: every `emoji` below is the legacy glyph shipped apps (≤ 1.1.x) render.
 * Each such object also carries `icon` (design/icons.json); 1.2.0+ clients get
 * `emoji: null` (lib/design/icon-compat.ts) and render the key.
 */
import type { IconKey } from '@/lib/design/icons';


export type CampaignTemplate = 'seasonal_circle' | 'daily_calendar' | 'spotlight';
export type CampaignPhase = 'teaser' | 'live' | 'ended';
export type CampaignStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'archived';
export type CampaignGlyph = 'snowflake' | 'gift' | 'year' | 'sun' | 'moon' | 'flame' | 'leaf' | 'heart' | 'star' | 'bolt';
export type CampaignCtaAction = 'start_circle' | 'open_calendar' | 'invite' | 'paywall' | 'circles' | 'open_url';
export type ArtSlot = 'appStoreCard' | 'appStoreDetails' | 'inAppHero' | 'emailHeader';

export const ART_SLOT_SIZES: Record<ArtSlot, { width: number; height: number }> = {
  appStoreCard: { width: 1920, height: 1080 },
  appStoreDetails: { width: 1080, height: 1920 },
  inAppHero: { width: 1200, height: 675 },
  emailHeader: { width: 1200, height: 480 },
};

export interface CircleTemplate {
  name: string;
  description: string;
  type: 'custom' | 'step_count' | 'workout_minutes' | 'weight_loss';
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export interface CalendarDoorContent {
  day: number; // 1-based
  emoji: string;
  /** Icon key; derived from `emoji` when absent. */
  icon?: IconKey;
  title: string;
  task: string;
}

export interface CampaignMark {
  date: string; // YYYY-MM-DD
  emoji: string;
  /** Icon key; derived from `emoji` when absent. */
  icon?: IconKey;
  label: string;
}

export interface ArtAsset {
  url: string;
  width: number;
  height: number;
  generated: boolean;
  updatedAt: string;
}

export type NotificationAudience = 'all' | 'participants' | 'reminders';
export interface CampaignNotification {
  key: string;
  kind: 'launch' | 'daily' | 'last_day' | 'custom';
  sendOn?: string | null;
  localHour: number;
  title: string;
  body: string;
  audience: NotificationAudience;
  enabled: boolean;
}

export interface CampaignEmail {
  key: string;
  kind: 'launch' | 'daily' | 'last_day' | 'custom';
  sendOn?: string | null;
  localHour: number;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  ctaLabel: string;
  audience: 'all' | 'participants';
  enabled: boolean;
}

export type AppStoreBadge =
  | 'CHALLENGE' | 'COMPETITION' | 'LIVE_EVENT' | 'MAJOR_UPDATE' | 'NEW_SEASON' | 'PREMIERE' | 'SPECIAL_EVENT';

export interface CampaignAppStore {
  name?: string;
  shortDescription?: string;
  longDescription?: string;
  badge?: AppStoreBadge;
  purpose?: 'APPROPRIATE_FOR_ALL_USERS' | 'ATTRACT_NEW_USERS' | 'KEEP_ACTIVE_USERS_INFORMED' | 'BRING_BACK_LAPSED_USERS';
  priority?: 'HIGH' | 'NORMAL';
  eventId?: string | null;
  state?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

/** Admin-editable fields (create / PATCH body). */
export interface CampaignInput {
  slug: string;
  template: CampaignTemplate;
  title: string;
  emoji: string;
  /** Icon key (campaigns.icon, migration 114); derived from `emoji` when absent. */
  icon?: IconKey | null;
  tagline: string;
  description: string;
  ctaLabel?: string | null;
  accent: string;
  palette: [string, string, string];
  glyph: CampaignGlyph;
  featuredFrom: string;
  startsAt: string;
  endsAt: string;
  priority: number;
  cta: { action: CampaignCtaAction; url?: string | null };
  circle: CircleTemplate | null;
  calendar: { doors: CalendarDoorContent[] } | null;
  marks: CampaignMark[];
  notifications: CampaignNotification[];
  emails: CampaignEmail[];
  appStore: CampaignAppStore;
  play: { title?: string; description?: string; exportedAt?: string | null };
}

export interface AdminCampaign extends CampaignInput {
  id: string;
  status: CampaignStatus;
  published: boolean;
  publishedAt: string | null;
  archivedAt: string | null;
  art: Partial<Record<ArtSlot, ArtAsset>>;
  legacySeasonKey: string | null;
  previewUserIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type DoorState = 'locked' | 'today' | 'opened' | 'missed';

export interface CalendarDoorView {
  day: number;
  date: string;
  state: DoorState;
  emoji?: string | null;
  /** Icon key of a revealed door with content; null otherwise. */
  icon?: IconKey | null;
  title?: string | null;
  task?: string | null;
}

export interface CalendarFriend {
  userId: string;
  name: string;
  avatarUrl: string | null;
  openedToday: boolean;
}

export interface CalendarView {
  doors: CalendarDoorView[];
  openedCount: number;
  todayOpened: boolean;
  streak: number;
  friends: { openedToday: number; total: number; members: CalendarFriend[] };
}

/** What GET /api/mobile/campaigns returns per campaign. */
export interface CampaignView {
  id: string;
  slug: string;
  template: CampaignTemplate;
  title: string;
  emoji: string;
  icon: IconKey;
  tagline: string;
  description: string;
  accent: string;
  palette: string[];
  glyph: CampaignGlyph;
  ctaLabel: string;
  cta: { action: CampaignCtaAction; url: string | null };
  featuredFrom: string;
  startsAt: string;
  endsAt: string;
  phase: CampaignPhase;
  today: string;
  dayNumber: number | null;
  totalDays: number;
  daysUntilStart: number | null;
  daysLeft: number | null;
  art: { inAppHero: string | null; appStoreCard: string | null; appStoreDetails: string | null; emailHeader: string | null };
  /** width / height of art.inAppHero (e.g. 1.778 for 1200x675) so clients can size it without cropping. */
  heroAspect: number | null;
  circle: CircleTemplate | null;
  marks: CampaignMark[];
  participant: { joined: boolean; reminders: boolean };
  calendar: CalendarView | null;
  /** "How it works" steps for the campaign info sheet (template defaults, dates filled in). */
  howItWorks: CampaignStep[];
  isPreview: boolean;
}

export interface CampaignStep {
  emoji: string;
  icon: IconKey;
  title: string;
  body: string;
}

export interface CampaignsResponse {
  campaigns: CampaignView[];
  homeSlug: string | null;
}

export const DEFAULT_CTA_LABEL: Record<CampaignTemplate, string> = {
  seasonal_circle: 'Start a circle',
  daily_calendar: 'Open the calendar',
  spotlight: 'Take a look',
};
