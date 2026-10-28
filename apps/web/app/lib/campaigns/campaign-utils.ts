/**
 * Pure campaign helpers shared by the admin portal and the web app:
 * calendar-day math, palette presets, App Store rules, the publish checklist,
 * the door idea library and a local CampaignView builder used by the portal's
 * preview (CAMPAIGNS_SPEC §1, §3, §7, §9). No React / Next imports.
 */

import { resolveIconKey, type IconKey } from '@/lib/design/icons';

import type {
  AdminCampaign,
  ArtSlot,
  CalendarDoorContent,
  CalendarDoorView,
  CampaignCtaAction,
  CampaignGlyph,
  CampaignInput,
  CampaignMark,
  CampaignPhase,
  CampaignStep,
  CampaignTemplate,
  CampaignView,
} from './types';
import { DEFAULT_CTA_LABEL } from './types';

// ---------------------------------------------------------------------------
// Calendar days (YYYY-MM-DD, timezone-free)
// ---------------------------------------------------------------------------

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toUtc(ymd: string): number {
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
}

export function addDays(ymd: string, days: number): string {
  return new Date(toUtc(ymd) + days * 86_400_000).toISOString().slice(0, 10);
}

/** b − a in days (negative when b is before a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Inclusive length of [start, end] in days (0 when invalid/reversed). */
export function spanDays(start: string, end: string): number {
  if (!isYmd(start) || !isYmd(end)) return 0;
  return Math.max(0, diffDays(start, end) + 1);
}

/** Local "today" as YYYY-MM-DD. */
export function todayYmd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "Nov 15" */
export function shortDate(ymd: string): string {
  if (!isYmd(ymd)) return '';
  return `${MONTHS[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}`;
}

/** "Nov 15 – Dec 15", "Dec 1 – 24" */
export function dateRange(start: string, end: string): string {
  if (!isYmd(start) || !isYmd(end)) return '';
  if (start.slice(0, 7) === end.slice(0, 7)) return `${shortDate(start)} – ${+end.slice(8, 10)}`;
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/** The art's date line: "NOV 15 – DEC 15". */
export function artDateLine(start: string, end: string): string {
  return dateRange(start, end).toUpperCase();
}

// ---------------------------------------------------------------------------
// Palettes / glyphs
// ---------------------------------------------------------------------------

export interface PalettePreset {
  id: 'winter' | 'festive' | 'newyear' | 'moonlight' | 'spring' | 'brand';
  name: string;
  colors: [string, string, string];
  accent: string;
  particles: 'snow' | 'confetti' | 'none';
}

export const PALETTE_PRESETS: readonly PalettePreset[] = [
  { id: 'winter', name: 'Winter', colors: ['#8b5cf6', '#22d3ee', '#ec4899'], accent: '#38bdf8', particles: 'snow' },
  { id: 'festive', name: 'Festive', colors: ['#f43f5e', '#f59e0b', '#a855f7'], accent: '#f59e0b', particles: 'snow' },
  { id: 'newyear', name: 'New Year', colors: ['#a855f7', '#38d9f5', '#fbbf24'], accent: '#a78bfa', particles: 'confetti' },
  { id: 'moonlight', name: 'Moonlight', colors: ['#4f46e5', '#14b8a6', '#eab308'], accent: '#fde68a', particles: 'none' },
  { id: 'spring', name: 'Spring', colors: ['#22c55e', '#f472b6', '#facc15'], accent: '#34d399', particles: 'confetti' },
  { id: 'brand', name: 'Brand', colors: ['#8b5cf6', '#6366f1', '#f97316'], accent: '#8b5cf6', particles: 'none' },
];

/** Art glyphs. `emoji` is the admin picker's legacy preview; `icon` is the key apps render. */
export const GLYPHS: readonly { id: CampaignGlyph; label: string; emoji: string; icon: IconKey }[] = [
  { id: 'snowflake', label: 'Snowflake', emoji: '❄️', icon: 'snowflake' },
  { id: 'gift', label: 'Gift', emoji: '🎁', icon: 'gift' },
  { id: 'year', label: 'Year', emoji: '🔢', icon: 'calendar' },
  { id: 'sun', label: 'Sun', emoji: '☀️', icon: 'sun' },
  { id: 'moon', label: 'Moon', emoji: '🌙', icon: 'moon' },
  { id: 'flame', label: 'Flame', emoji: '🔥', icon: 'flame' },
  { id: 'leaf', label: 'Leaf', emoji: '🍃', icon: 'leaf' },
  { id: 'heart', label: 'Heart', emoji: '💜', icon: 'heart' },
  { id: 'star', label: 'Star', emoji: '⭐', icon: 'star' },
  { id: 'bolt', label: 'Bolt', emoji: '⚡', icon: 'bolt' },
];

export const GLYPH_ICON: Record<CampaignGlyph, IconKey> = Object.fromEntries(GLYPHS.map((g) => [g.id, g.icon])) as Record<CampaignGlyph, IconKey>;

export function matchPreset(palette: readonly string[]): PalettePreset | null {
  const p = palette.map((c) => c.toLowerCase()).join(',');
  return PALETTE_PRESETS.find((x) => x.colors.join(',') === p) ?? null;
}

export function particlesFor(glyph: CampaignGlyph, palette: readonly string[]): 'snow' | 'confetti' | 'none' {
  const preset = matchPreset(palette);
  if (preset) return preset.particles;
  if (glyph === 'snowflake' || glyph === 'gift') return 'snow';
  if (glyph === 'year' || glyph === 'star' || glyph === 'heart' || glyph === 'bolt') return 'confetti';
  return 'none';
}

// ---------------------------------------------------------------------------
// Phase / preview view
// ---------------------------------------------------------------------------

export function phaseOn(c: Pick<CampaignInput, 'featuredFrom' | 'startsAt' | 'endsAt'>, today: string): CampaignPhase | null {
  if (!isYmd(today) || !isYmd(c.startsAt) || !isYmd(c.endsAt)) return null;
  const featured = isYmd(c.featuredFrom) ? c.featuredFrom : c.startsAt;
  if (today >= c.startsAt && today <= c.endsAt) return 'live';
  if (today >= featured && today < c.startsAt) return 'teaser';
  if (today > c.endsAt && today <= addDays(c.endsAt, 2)) return 'ended';
  return null;
}

/**
 * A CampaignView built locally from editor state so the portal can preview every
 * surface at any date without the backend. Calendar progress is simulated:
 * every past door opened except every 5th (missed), today's door per `todayOpened`.
 */
export function buildPreviewView(
  c: CampaignInput & { id?: string; art?: AdminCampaign['art'] },
  today: string,
  opts: { todayOpened?: boolean; joined?: boolean; reminders?: boolean } = {}
): CampaignView & { phaseOrHidden: CampaignPhase | null } {
  const phaseOrHidden = phaseOn(c, today);
  const phase: CampaignPhase = phaseOrHidden ?? (today < c.startsAt ? 'teaser' : 'ended');
  const totalDays = spanDays(c.startsAt, c.endsAt);
  const dayNumber = phase === 'live' ? diffDays(c.startsAt, today) + 1 : null;
  const todayOpened = opts.todayOpened ?? false;

  let calendar: CampaignView['calendar'] = null;
  if (c.template === 'daily_calendar') {
    const content = new Map((c.calendar?.doors ?? []).map((d) => [d.day, d]));
    const passed = phase === 'ended' ? totalDays : dayNumber ?? 0;
    const doors: CalendarDoorView[] = [];
    for (let day = 1; day <= totalDays; day++) {
      const visible = day <= passed;
      let state: CalendarDoorView['state'] = 'locked';
      if (visible) {
        if (day === dayNumber) state = todayOpened ? 'opened' : 'today';
        else state = day % 5 === 0 ? 'missed' : 'opened';
      }
      const d = content.get(day);
      doors.push({
        day,
        date: addDays(c.startsAt, day - 1),
        state,
        emoji: visible ? d?.emoji ?? null : null,
        icon: visible && d ? resolveIconKey(d.icon, d.emoji) : null,
        title: visible ? d?.title ?? null : null,
        task: visible ? d?.task ?? null : null,
      });
    }
    const openedCount = doors.filter((d) => d.state === 'opened').length;
    let streak = 0;
    for (let i = (dayNumber ?? passed) - (todayOpened || phase !== 'live' ? 1 : 2); i >= 0; i--) {
      if (doors[i]?.state === 'opened') streak++;
      else break;
    }
    const names = ['Maya', 'Leo', 'Priya', 'Sam', 'Jules', 'Noor', 'Alex', 'Kai'];
    calendar = {
      doors,
      openedCount,
      todayOpened: phase === 'live' && todayOpened,
      streak,
      friends: {
        openedToday: phase === 'live' ? 5 : 0,
        total: 8,
        members: names.map((name, i) => ({ userId: `preview-${i}`, name, avatarUrl: null, openedToday: phase === 'live' && i < 5 })),
      },
    };
  }

  const art = c.art ?? {};
  return {
    id: c.id ?? 'preview',
    slug: c.slug,
    template: c.template,
    title: c.title,
    emoji: c.emoji,
    icon: resolveIconKey(c.icon, c.emoji, GLYPH_ICON[c.glyph]),
    tagline: c.tagline,
    description: c.description,
    accent: c.accent,
    palette: [...c.palette],
    glyph: c.glyph,
    ctaLabel: c.ctaLabel?.trim() || DEFAULT_CTA_LABEL[c.template],
    cta: { action: c.cta.action, url: c.cta.url ?? null },
    featuredFrom: c.featuredFrom,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    phase,
    today,
    dayNumber,
    totalDays,
    daysUntilStart: phase === 'teaser' ? diffDays(today, c.startsAt) : null,
    daysLeft: phase === 'live' ? diffDays(today, c.endsAt) : null,
    art: {
      inAppHero: art.inAppHero?.url ?? null,
      appStoreCard: art.appStoreCard?.url ?? null,
      appStoreDetails: art.appStoreDetails?.url ?? null,
      emailHeader: art.emailHeader?.url ?? null,
    },
    heroAspect: art.inAppHero?.width && art.inAppHero?.height ? Math.round((art.inAppHero.width / art.inAppHero.height) * 1000) / 1000 : null,
    circle: c.circle,
    marks: (c.marks ?? []).map((m) => ({ ...m, icon: resolveIconKey(m.icon, m.emoji, 'calendar') })),
    participant: { joined: opts.joined ?? false, reminders: opts.reminders ?? false },
    calendar,
    howItWorks: howItWorksFor(c),
    isPreview: true,
    phaseOrHidden,
  };
}

/** The phase line on cards: "Starts Nov 15 · fill your seats", "Day 9 of 30", "That's a wrap". */
export function phaseLine(v: Pick<CampaignView, 'phase' | 'startsAt' | 'dayNumber' | 'totalDays' | 'daysUntilStart' | 'daysLeft' | 'template'>): string {
  if (v.phase === 'teaser') {
    const when = v.daysUntilStart === 1 ? 'Starts tomorrow' : `Starts ${shortDate(v.startsAt)}`;
    return v.template === 'seasonal_circle' ? `${when} · fill your seats` : when;
  }
  if (v.phase === 'live') {
    if (v.daysLeft === 0) return `Last day · Day ${v.dayNumber} of ${v.totalDays}`;
    return `Day ${v.dayNumber} of ${v.totalDays}`;
  }
  return "That's a wrap. Thanks for showing up";
}

// ---------------------------------------------------------------------------
// App Store rules (§7) and the publish checklist (§9.8)
// ---------------------------------------------------------------------------

export const APP_STORE_LIMITS = { name: 30, shortDescription: 50, longDescription: 120, maxEventDays: 31, maxPromoDays: 14 };

export interface AppStoreRules {
  eventDays: number;
  durationOk: boolean;
  /** When the App Store promotion starts (featuredFrom, capped to startsAt − 14d). */
  promoStart: string | null;
  promoCapped: boolean;
  promoDays: number;
}

export function appStoreRules(c: Pick<CampaignInput, 'featuredFrom' | 'startsAt' | 'endsAt'>): AppStoreRules {
  const eventDays = spanDays(c.startsAt, c.endsAt);
  if (!isYmd(c.startsAt)) return { eventDays, durationOk: false, promoStart: null, promoCapped: false, promoDays: 0 };
  const earliest = addDays(c.startsAt, -APP_STORE_LIMITS.maxPromoDays);
  const featured = isYmd(c.featuredFrom) ? c.featuredFrom : c.startsAt;
  const promoStart = featured < earliest ? earliest : featured;
  return {
    eventDays,
    durationOk: eventDays > 0 && eventDays <= APP_STORE_LIMITS.maxEventDays,
    promoStart,
    promoCapped: featured < earliest,
    promoDays: Math.max(0, diffDays(promoStart, c.startsAt)),
  };
}

export const SLUG_RE = /^[a-z0-9_]{3,40}$/;
export const COPY_LIMITS = { title: 40, emoji: 8, tagline: 80, description: 280, ctaLabel: 24 } as const;

export interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  /** Blocking items stop publishing; others are advice. */
  blocking: boolean;
  hint?: string;
  section: SectionId;
}

export type SectionId = 'basics' | 'dates' | 'content' | 'creative' | 'messages' | 'channels' | 'preview' | 'golive';

export function publishChecklist(c: AdminCampaign | (CampaignInput & { art?: AdminCampaign['art'] })): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (i: ChecklistItem) => items.push(i);
  const len = (s: string | null | undefined) => (s ?? '').trim().length;

  add({ id: 'slug', label: 'Slug is valid', ok: SLUG_RE.test(c.slug), blocking: true, hint: 'a–z, 0–9, _ · 3–40 chars', section: 'basics' });
  add({
    id: 'copy',
    label: 'Title, emoji, tagline and description',
    ok:
      len(c.title) > 0 && len(c.title) <= COPY_LIMITS.title && len(c.emoji) > 0 && len(c.tagline) > 0 &&
      len(c.tagline) <= COPY_LIMITS.tagline && len(c.description) > 0 && len(c.description) <= COPY_LIMITS.description,
    blocking: true,
    section: 'basics',
  });
  const datesOk = isYmd(c.startsAt) && isYmd(c.endsAt) && c.startsAt <= c.endsAt && (!c.featuredFrom || (isYmd(c.featuredFrom) && c.featuredFrom <= c.startsAt));
  add({ id: 'dates', label: 'Dates in order (featured ≤ start ≤ end)', ok: datesOk, blocking: true, section: 'dates' });
  if (c.template === 'seasonal_circle') {
    add({ id: 'circle', label: 'Circle template filled in', ok: Boolean(c.circle && len(c.circle.name) > 0), blocking: true, section: 'content' });
  }
  if (c.template === 'daily_calendar') {
    const days = spanDays(c.startsAt, c.endsAt);
    const doors = c.calendar?.doors ?? [];
    const complete = days > 0 && doors.length >= days && Array.from({ length: days }, (_, i) => doors.find((d) => d.day === i + 1)).every((d) => d && len(d.title) > 0 && len(d.task) > 0 && len(d.emoji) > 0);
    add({ id: 'doors', label: `Every door has content (${Math.min(doors.length, days)}/${days})`, ok: complete, blocking: true, section: 'content' });
  }
  if (c.template === 'spotlight' && c.cta.action === 'open_url') {
    add({ id: 'cta_url', label: 'CTA URL set', ok: /^https:\/\//.test(c.cta.url ?? ''), blocking: true, section: 'content' });
  }
  const art = c.art ?? {};
  add({
    id: 'hero',
    label: 'In-app hero art',
    ok: Boolean(art.inAppHero),
    blocking: false,
    hint: 'Without it the apps show a gradient + icon fallback',
    section: 'creative',
  });
  const rules = appStoreRules(c);
  add({ id: 'as_duration', label: `App Store: event ≤ 31 days (${rules.eventDays})`, ok: rules.durationOk, blocking: false, section: 'dates' });
  const as = c.appStore ?? {};
  add({
    id: 'as_copy',
    label: 'App Store copy within limits',
    ok:
      len(as.name) > 0 && len(as.name) <= APP_STORE_LIMITS.name && len(as.shortDescription) > 0 &&
      len(as.shortDescription) <= APP_STORE_LIMITS.shortDescription && len(as.longDescription) > 0 &&
      len(as.longDescription) <= APP_STORE_LIMITS.longDescription,
    blocking: false,
    section: 'channels',
  });
  add({ id: 'as_art', label: 'App Store card + details art', ok: Boolean(art.appStoreCard && art.appStoreDetails), blocking: false, section: 'creative' });
  const pushOk = c.notifications.every((m) => len(m.title) > 0 && len(m.title) <= 60 && len(m.body) > 0 && len(m.body) <= 140);
  add({ id: 'push', label: 'Push messages valid', ok: pushOk, blocking: true, section: 'messages' });
  const emailOk = c.emails.every((m) => len(m.subject) > 0 && len(m.subject) <= 80 && len(m.heading) <= 60 && len(m.body) > 0 && len(m.body) <= 600);
  add({ id: 'email', label: 'Emails valid', ok: emailOk, blocking: true, section: 'messages' });
  return items;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const PLACEHOLDERS: readonly { token: string; help: string; dailyOnly?: boolean }[] = [
  { token: '{{first_name}}', help: "Recipient's first name" },
  { token: '{{title}}', help: 'Campaign title' },
  { token: '{{days_left}}', help: 'Days until the end' },
  { token: '{{day}}', help: 'Door / day number', dailyOnly: true },
  { token: '{{door_title}}', help: "Today's door title", dailyOnly: true },
  { token: '{{door_emoji}}', help: "Today's door emoji (in-app only: push copy is sent without emoji)", dailyOnly: true },
];

export function renderPlaceholders(text: string, ctx: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => {
    const v = ctx[key];
    return v === undefined || v === null || v === '' ? m : String(v);
  });
}

export function placeholderContext(v: CampaignView, firstName = 'Alex'): Record<string, string | number | null> {
  const door = v.calendar?.doors.find((d) => d.day === v.dayNumber) ?? v.calendar?.doors[0];
  return {
    first_name: firstName,
    title: v.title,
    days_left: v.daysLeft ?? v.totalDays,
    day: v.dayNumber ?? 1,
    door_title: door?.title ?? null,
    door_emoji: door?.emoji ?? null,
  };
}

export function uniqueKey(prefix: string, existing: readonly { key: string }[]): string {
  const keys = new Set(existing.map((e) => e.key));
  if (!keys.has(prefix)) return prefix;
  for (let i = 2; ; i++) if (!keys.has(`${prefix}_${i}`)) return `${prefix}_${i}`;
}

// ---------------------------------------------------------------------------
// Door idea library (daily_calendar)
// ---------------------------------------------------------------------------

export const DOOR_IDEAS: readonly Omit<CalendarDoorContent, 'day'>[] = [
  { emoji: '🚶', icon: 'walk', title: 'First steps', task: 'A 10-minute walk, any pace.' },
  { emoji: '💧', icon: 'water', title: 'Water first', task: 'A glass of water before your first coffee or tea.' },
  { emoji: '🧘', icon: 'mindful', title: 'Unclench', task: '5 minutes of stretching: neck, shoulders, hips.' },
  { emoji: '🥦', icon: 'produce', title: 'Add a colour', task: 'Add one vegetable or fruit to a meal.' },
  { emoji: '📵', icon: 'no_phone', title: 'Screen-free bite', task: 'Eat one meal without your phone.' },
  { emoji: '👟', icon: 'steps', title: 'Step it up', task: '6,000 steps today.' },
  { emoji: '😴', icon: 'sleep', title: 'Wind down', task: 'Lights out 20 minutes earlier tonight.' },
  { emoji: '🙌', icon: 'chat', title: 'Cheer someone', task: "React to a friend's post in your circle." },
  { emoji: '🪜', icon: 'stairs', title: 'Take the stairs', task: 'Pick stairs over the lift or escalator today.' },
  { emoji: '🍲', icon: 'cook', title: 'Cook it', task: 'Make one meal at home.' },
  { emoji: '🌬️', icon: 'breathe', title: 'Breathe', task: '2 minutes of slow breathing (4 in, 6 out).' },
  { emoji: '🏃', icon: 'run', title: 'Move 20', task: '20 minutes of any movement you enjoy.' },
  { emoji: '🍎', icon: 'produce', title: 'Smart snack', task: 'Swap one snack for fruit or nuts.' },
  { emoji: '🧊', icon: 'water', title: 'Hydrate', task: '8 glasses of water today.' },
  { emoji: '📝', icon: 'note', title: 'Log it all', task: 'Log every meal today.' },
  { emoji: '☀️', icon: 'sun', title: 'Daylight', task: '10 minutes outside in daylight.' },
  { emoji: '💪', icon: 'strength', title: 'Mini workout', task: '10 squats, 10 push-ups (any version), 20-second plank.' },
  { emoji: '🫶', icon: 'person_add', title: 'Bring a friend', task: 'Invite one friend to join your circle.' },
  { emoji: '🍵', icon: 'beverage', title: 'Slow sip', task: 'Swap one sugary drink for water or tea.' },
  { emoji: '🎶', icon: 'music', title: 'Dance break', task: 'One song, full volume, dance it out.' },
  { emoji: '🌙', icon: 'moon', title: 'Evening stroll', task: 'A short walk after dinner.' },
  { emoji: '🥗', icon: 'produce', title: 'Plate check', task: 'Half your plate vegetables at one meal.' },
  { emoji: '🤝', icon: 'community', title: 'Walk and talk', task: 'Walk with someone you love.' },
  { emoji: '🏆', icon: 'trophy', title: 'Share a win', task: 'Check in and share one win from this month.' },
  { emoji: '🧘‍♀️', icon: 'mindful', title: 'Stretch it out', task: '10 minutes of yoga or mobility.' },
  { emoji: '🥚', icon: 'meal', title: 'Protein first', task: 'Start one meal with a protein.' },
  { emoji: '🫐', icon: 'produce', title: 'Berry good', task: 'Add a handful of berries to your day.' },
  { emoji: '📖', icon: 'book', title: 'Read, not scroll', task: '10 minutes with a book before bed.' },
  { emoji: '🚲', icon: 'cycle', title: 'Wheels', task: 'Bike, scoot or skate somewhere instead of driving.' },
  { emoji: '🧺', icon: 'basket', title: 'Prep ahead', task: "Prep tomorrow's lunch tonight." },
  { emoji: '🌳', icon: 'tree', title: 'Green time', task: 'Spend 15 minutes in a park or garden.' },
  { emoji: '🍽️', icon: 'meal', title: 'Slow down', task: 'Put your fork down between bites at one meal.' },
  { emoji: '⏱️', icon: 'stopwatch', title: 'Desk break', task: 'Stand up and move for 2 minutes every hour.' },
  { emoji: '🏊', icon: 'swim', title: 'Try something new', task: 'Try a workout you have never done before.' },
  { emoji: '🧡', icon: 'chat', title: 'Kind words', task: 'Send a friend an encouraging message.' },
  { emoji: '🌅', icon: 'sunrise', title: 'Early light', task: 'Get outside within an hour of waking.' },
  { emoji: '🥜', icon: 'meal', title: 'Fuel up', task: 'Have a balanced breakfast.' },
  { emoji: '🎯', icon: 'target', title: 'Set a goal', task: 'Write down one small goal for this week.' },
  { emoji: '🙏', icon: 'heart', title: 'Gratitude', task: 'Note three things you are grateful for.' },
  { emoji: '🎉', icon: 'celebration', title: 'Celebrate', task: 'Check in and celebrate how far you have come.' },
];

/**
 * Fills door slots 1…days. Keeps existing doors with content; empty days get the
 * next unused idea (rotating through the library). `overwrite` replaces everything.
 */
export function fillDoorsFromIdeas(
  days: number,
  existing: readonly CalendarDoorContent[],
  opts: { overwrite?: boolean; offset?: number } = {}
): CalendarDoorContent[] {
  const byDay = new Map(existing.map((d) => [d.day, d]));
  const used = new Set(opts.overwrite ? [] : existing.map((d) => d.title.trim().toLowerCase()));
  const pool = DOOR_IDEAS.filter((i) => !used.has(i.title.toLowerCase()));
  let next = opts.offset ?? 0;
  const out: CalendarDoorContent[] = [];
  for (let day = 1; day <= days; day++) {
    const cur = byDay.get(day);
    if (!opts.overwrite && cur && cur.title.trim() && cur.task.trim()) {
      out.push(cur);
      continue;
    }
    const src = pool.length ? pool[next++ % pool.length] : DOOR_IDEAS[next++ % DOOR_IDEAS.length];
    // The last door is a finale whenever we pick it.
    const idea = day === days && days > 1 ? DOOR_IDEAS[DOOR_IDEAS.length - 1] : src;
    out.push({ day, ...idea });
  }
  return out;
}

/** Re-sizes the doors array to `days` (keeps content by day, adds blank rows). */
export function resizeDoors(days: number, doors: readonly CalendarDoorContent[]): CalendarDoorContent[] {
  const byDay = new Map(doors.map((d) => [d.day, d]));
  return Array.from({ length: Math.max(0, days) }, (_, i) => byDay.get(i + 1) ?? { day: i + 1, emoji: '', title: '', task: '' });
}

// ---------------------------------------------------------------------------
// New campaign defaults
// ---------------------------------------------------------------------------

export const CTA_ACTIONS: Record<CampaignTemplate, CampaignCtaAction[]> = {
  seasonal_circle: ['start_circle'],
  daily_calendar: ['open_calendar'],
  spotlight: ['invite', 'paywall', 'circles', 'start_circle', 'open_url'],
};

export const CTA_LABELS: Record<CampaignCtaAction, string> = {
  start_circle: 'Start a circle',
  open_calendar: 'Open the calendar',
  invite: 'Invite friends',
  paywall: 'See Pro',
  circles: 'Go to Circles',
  open_url: 'Open a link',
};

export function newCampaignInput(template: CampaignTemplate, today: string = todayYmd()): CampaignInput {
  const startsAt = addDays(today, 21);
  const endsAt = addDays(startsAt, template === 'daily_calendar' ? 13 : 29);
  const preset = PALETTE_PRESETS[0];
  const base: CampaignInput = {
    slug: '',
    template,
    title: '',
    emoji: template === 'daily_calendar' ? '🎁' : '✨',
    icon: template === 'daily_calendar' ? 'gift' : 'sparkles',
    tagline: '',
    description: '',
    ctaLabel: null,
    accent: preset.accent,
    palette: [...preset.colors],
    glyph: template === 'daily_calendar' ? 'gift' : 'star',
    featuredFrom: addDays(startsAt, -14),
    startsAt,
    endsAt,
    priority: 0,
    cta: { action: CTA_ACTIONS[template][0], url: null },
    circle: null,
    calendar: null,
    marks: [],
    notifications: [],
    emails: [],
    appStore: { badge: 'CHALLENGE', purpose: 'APPROPRIATE_FOR_ALL_USERS', priority: 'NORMAL' },
    play: {},
  };
  if (template !== 'spotlight') {
    base.circle = { name: '', description: '', type: 'custom', startDate: startsAt, endDate: endsAt };
  }
  if (template === 'daily_calendar') base.calendar = { doors: resizeDoors(spanDays(startsAt, endsAt), []) };
  return base;
}

/** Strips server-only fields so an AdminCampaign can be sent as a PATCH body. */
export function toInput(c: AdminCampaign | CampaignInput): CampaignInput {
  return {
    slug: c.slug,
    template: c.template,
    title: c.title,
    emoji: c.emoji,
    icon: c.icon ?? null,
    tagline: c.tagline,
    description: c.description,
    ctaLabel: c.ctaLabel ?? null,
    accent: c.accent,
    palette: [c.palette[0], c.palette[1], c.palette[2]],
    glyph: c.glyph,
    featuredFrom: c.featuredFrom,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    priority: c.priority ?? 0,
    cta: { action: c.cta?.action ?? CTA_ACTIONS[c.template][0], url: c.cta?.url ?? null },
    circle: c.circle ?? null,
    calendar: c.calendar ?? null,
    marks: c.marks ?? [],
    notifications: c.notifications ?? [],
    emails: c.emails ?? [],
    appStore: c.appStore ?? {},
    play: c.play ?? {},
  };
}

export const ART_SLOT_LABELS: Record<ArtSlot, string> = {
  appStoreCard: 'App Store event card',
  appStoreDetails: 'App Store details page',
  inAppHero: 'In-app hero',
  emailHeader: 'Email header',
};

/**
 * "How it works" for the in-app campaign info sheet. Template defaults with the campaign's own
 * dates and milestones filled in, so every campaign explains itself without extra admin copy.
 */
export function howItWorksFor(c: { template: CampaignTemplate; startsAt: string; endsAt: string; marks?: CampaignMark[] | null }): CampaignStep[] {
  // Milestones (marks) are shown as the sheet's timeline, so they aren't repeated here.
  const range = `${shortDate(c.startsAt)}–${shortDate(c.endsAt)}`;
  switch (c.template) {
    case 'seasonal_circle':
      return [
        { emoji: '👥', icon: 'community', title: 'Fill 5 seats', body: `Invite 4 friends before ${shortDate(c.startsAt)}.` },
        { emoji: '✅', icon: 'check', title: 'Check in daily', body: `${range}. A meal, a walk, water: it all counts.` },
        { emoji: '🔥', icon: 'flame', title: 'Keep the streak', body: 'Show up together. Friends can save a missed day.' },
      ];
    case 'daily_calendar':
      return [
        { emoji: '🗓️', icon: 'calendar', title: 'A door a day', body: `${range}. A new mini challenge each morning.` },
        { emoji: '✅', icon: 'check', title: 'Do the tiny task', body: 'A few minutes, then tap done.' },
        { emoji: '👯', icon: 'community', title: 'Cheer friends on', body: 'See who opened today.' },
      ];
    default:
      return [{ emoji: '✨', icon: 'sparkles', title: 'Jump in', body: `Running ${range}.` }];
  }
}
