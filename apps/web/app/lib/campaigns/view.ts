/**
 * Pure CampaignView builder (docs/CAMPAIGNS_SPEC.md §3). All I/O happens in
 * CampaignService; this file turns a row + the viewer's context into the wire
 * shape, so every phase/door rule is unit-testable without a database.
 */
import { addDays, daysBetween } from '@/lib/streaks/streak-calculator';

import { howItWorksFor } from './campaign-utils';
import { PHASE_RANK, dateOfDay, totalDaysOf, type CampaignRow } from './model';
import {
  DEFAULT_CTA_LABEL,
  type CalendarDoorView,
  type CalendarFriend,
  type CalendarView,
  type CampaignPhase,
  type CampaignView,
} from './types';

export const FRIENDS_SHOWN = 8;

export interface ViewContext {
  today: string;
  phase: CampaignPhase;
  isPreview?: boolean;
  participant?: { joined: boolean; reminders: boolean } | null;
  /** Local dates (within the window) the viewer showed up. */
  openedDates?: Set<string>;
  /** The viewer's circle friends and whether each showed up today. */
  friends?: Array<{ userId: string; name: string; avatarUrl: string | null; openedToday: boolean }>;
}

export function buildCalendar(row: CampaignRow, ctx: ViewContext): CalendarView {
  const total = totalDaysOf(row);
  const opened = ctx.openedDates ?? new Set<string>();
  const { today, phase } = ctx;
  const dayNumber = phase === 'live' ? daysBetween(row.starts_at, today) + 1 : null;
  const content = new Map((row.calendar?.doors ?? []).map((d) => [d.day, d]));

  const doors: CalendarDoorView[] = [];
  let openedCount = 0;
  for (let day = 1; day <= total; day++) {
    const date = dateOfDay(row, day);
    const revealed = phase === 'ended' || (phase === 'live' && dayNumber !== null && day <= dayNumber);
    let state: CalendarDoorView['state'] = 'locked';
    if (revealed) {
      if (opened.has(date)) state = 'opened';
      else state = date === today ? 'today' : 'missed';
    }
    if (state === 'opened') openedCount++;
    const c = revealed ? content.get(day) : undefined;
    doors.push(
      revealed
        ? { day, date, state, emoji: c?.emoji ?? null, title: c?.title ?? null, task: c?.task ?? null }
        : { day, date, state }
    );
  }

  const inWindow = row.starts_at <= today && today <= row.ends_at;
  const todayOpened = phase === 'live' && inWindow && opened.has(today);

  // Consecutive opened doors ending today (or yesterday if today isn't opened yet).
  let streak = 0;
  let cursor = todayOpened ? today : addDays(today, -1);
  while (cursor >= row.starts_at && cursor <= row.ends_at && opened.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const friends = ctx.friends ?? [];
  const showFriendsToday = phase === 'live';
  const members: CalendarFriend[] = friends
    .map((f) => ({ ...f, openedToday: showFriendsToday && f.openedToday }))
    .sort((a, b) => Number(b.openedToday) - Number(a.openedToday) || a.name.localeCompare(b.name))
    .slice(0, FRIENDS_SHOWN);

  return {
    doors,
    openedCount,
    todayOpened,
    streak,
    friends: {
      openedToday: showFriendsToday ? friends.filter((f) => f.openedToday).length : 0,
      total: friends.length,
      members,
    },
  };
}

export function buildCampaignView(row: CampaignRow, ctx: ViewContext): CampaignView {
  const { today, phase } = ctx;
  const art = row.art ?? {};
  const totalDays = totalDaysOf(row);
  return {
    id: row.id,
    slug: row.slug,
    template: row.template,
    title: row.title,
    emoji: row.emoji,
    tagline: row.tagline,
    description: row.description,
    accent: row.accent,
    palette: row.palette ?? [],
    glyph: row.glyph,
    ctaLabel: row.cta_label || DEFAULT_CTA_LABEL[row.template] || 'Take a look',
    cta: { action: row.cta?.action ?? (row.template === 'daily_calendar' ? 'open_calendar' : 'start_circle'), url: row.cta?.url ?? null },
    featuredFrom: row.featured_from,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    phase,
    today,
    dayNumber: phase === 'live' ? daysBetween(row.starts_at, today) + 1 : null,
    totalDays,
    daysUntilStart: phase === 'teaser' ? daysBetween(today, row.starts_at) : null,
    daysLeft: phase === 'live' ? daysBetween(today, row.ends_at) + 1 : null,
    art: {
      inAppHero: art.inAppHero?.url ?? null,
      appStoreCard: art.appStoreCard?.url ?? null,
      appStoreDetails: art.appStoreDetails?.url ?? null,
      emailHeader: art.emailHeader?.url ?? null,
    },
    circle: row.circle_template ?? null,
    marks: row.marks ?? [],
    participant: { joined: !!ctx.participant?.joined, reminders: !!ctx.participant?.reminders },
    calendar: row.template === 'daily_calendar' ? buildCalendar(row, ctx) : null,
    howItWorks: howItWorksFor({ template: row.template, startsAt: row.starts_at, endsAt: row.ends_at, marks: row.marks }),
    isPreview: !!ctx.isPreview,
  };
}

/** Live before teaser before ended, then priority desc, then starts_at asc. */
export function compareViews(a: { phase: CampaignPhase; priority: number; startsAt: string }, b: typeof a): number {
  return PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || b.priority - a.priority || a.startsAt.localeCompare(b.startsAt);
}
