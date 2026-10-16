import { describe, expect, it } from 'vitest';

import {
  DOOR_IDEAS,
  addDays,
  appStoreRules,
  artDateLine,
  buildPreviewView,
  dateRange,
  diffDays,
  fillDoorsFromIdeas,
  isYmd,
  matchPreset,
  newCampaignInput,
  particlesFor,
  phaseLine,
  phaseOn,
  publishChecklist,
  renderPlaceholders,
  resizeDoors,
  spanDays,
  toInput,
  uniqueKey,
} from '../campaign-utils';

const advent = () => {
  const c = newCampaignInput('daily_calendar', '2026-11-01');
  return {
    ...c,
    slug: 'advent_2026',
    title: 'Advent Circle',
    tagline: 'A small healthy win behind every door.',
    description: 'Open one door a day.',
    featuredFrom: '2026-11-17',
    startsAt: '2026-12-01',
    endsAt: '2026-12-24',
    calendar: { doors: fillDoorsFromIdeas(24, []) },
    circle: { name: 'Advent Circle', description: 'x', type: 'custom' as const, startDate: '2026-12-01', endDate: '2026-12-24' },
  };
};

describe('calendar days', () => {
  it('adds, diffs and spans', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(diffDays('2026-12-01', '2026-12-24')).toBe(23);
    expect(spanDays('2026-11-15', '2026-12-15')).toBe(31);
    expect(spanDays('2026-12-15', '2026-11-15')).toBe(0);
    expect(isYmd('2026-02-30')).toBe(false);
  });
  it('formats ranges', () => {
    expect(dateRange('2026-12-01', '2026-12-24')).toBe('Dec 1 – 24');
    expect(artDateLine('2026-11-15', '2026-12-15')).toBe('NOV 15 – DEC 15');
  });
});

describe('phase', () => {
  const c = { featuredFrom: '2026-11-17', startsAt: '2026-12-01', endsAt: '2026-12-24' };
  it('teaser / live / ended / hidden', () => {
    expect(phaseOn(c, '2026-11-16')).toBeNull();
    expect(phaseOn(c, '2026-11-17')).toBe('teaser');
    expect(phaseOn(c, '2026-12-01')).toBe('live');
    expect(phaseOn(c, '2026-12-24')).toBe('live');
    expect(phaseOn(c, '2026-12-26')).toBe('ended');
    expect(phaseOn(c, '2026-12-27')).toBeNull();
  });
});

describe('buildPreviewView', () => {
  it('builds a live calendar with no peeking', () => {
    const v = buildPreviewView(advent(), '2026-12-07', { todayOpened: false });
    expect(v.phase).toBe('live');
    expect(v.dayNumber).toBe(7);
    expect(v.totalDays).toBe(24);
    expect(v.daysLeft).toBe(17);
    const doors = v.calendar!.doors;
    expect(doors).toHaveLength(24);
    expect(doors[6].state).toBe('today');
    expect(doors[4].state).toBe('missed');
    expect(doors[7].state).toBe('locked');
    expect(doors[7].title).toBeNull();
    expect(doors[6].title).toBeTruthy();
    expect(v.calendar!.streak).toBe(1); // day 6 opened, day 5 missed
    expect(phaseLine(v)).toBe('Day 7 of 24');
  });
  it('teaser has every door locked', () => {
    const v = buildPreviewView(advent(), '2026-11-20');
    expect(v.phase).toBe('teaser');
    expect(v.daysUntilStart).toBe(11);
    expect(v.calendar!.doors.every((d) => d.state === 'locked' && !d.title)).toBe(true);
  });
  it('non-calendar templates have no calendar', () => {
    expect(buildPreviewView(newCampaignInput('spotlight', '2026-11-01'), '2026-11-01').calendar).toBeNull();
  });
});

describe('appStoreRules', () => {
  it('caps the promo to 14 days before start and checks 31 days', () => {
    const r = appStoreRules({ featuredFrom: '2026-10-20', startsAt: '2026-11-15', endsAt: '2026-12-15' });
    expect(r.eventDays).toBe(31);
    expect(r.durationOk).toBe(true);
    expect(r.promoStart).toBe('2026-11-01');
    expect(r.promoCapped).toBe(true);
    expect(appStoreRules({ featuredFrom: '2027-01-25', startsAt: '2027-02-08', endsAt: '2027-03-11' }).durationOk).toBe(false);
  });
});

describe('publishChecklist', () => {
  it('passes a complete calendar campaign and blocks missing doors', () => {
    const ok = publishChecklist(advent());
    expect(ok.filter((i) => i.blocking && !i.ok)).toEqual([]);
    const broken = { ...advent(), calendar: { doors: resizeDoors(24, []) } };
    expect(publishChecklist(broken).find((i) => i.id === 'doors')?.ok).toBe(false);
  });
  it('requires a circle for seasonal campaigns and a https URL for open_url', () => {
    const s = { ...newCampaignInput('seasonal_circle', '2026-11-01'), circle: null };
    expect(publishChecklist(s).find((i) => i.id === 'circle')?.ok).toBe(false);
    const sp = { ...newCampaignInput('spotlight', '2026-11-01'), cta: { action: 'open_url' as const, url: 'http://x' } };
    expect(publishChecklist(sp).find((i) => i.id === 'cta_url')?.ok).toBe(false);
  });
});

describe('doors', () => {
  it('fills only empty doors and ends with the finale', () => {
    const existing = [{ day: 2, emoji: '⭐', title: 'Mine', task: 'Keep me' }];
    const doors = fillDoorsFromIdeas(10, existing);
    expect(doors).toHaveLength(10);
    expect(doors[1]).toEqual(existing[0]);
    expect(doors[9].title).toBe(DOOR_IDEAS[DOOR_IDEAS.length - 1].title);
    expect(doors.every((d) => d.title && d.task && d.emoji)).toBe(true);
  });
  it('resizes keeping content by day', () => {
    const doors = resizeDoors(3, [{ day: 2, emoji: 'a', title: 'b', task: 'c' }, { day: 9, emoji: 'x', title: 'y', task: 'z' }]);
    expect(doors.map((d) => d.title)).toEqual(['', 'b', '']);
  });
});

describe('misc', () => {
  it('renders placeholders, leaving unknown ones', () => {
    expect(renderPlaceholders('Door {{day}} {{door_emoji}} {{nope}}', { day: 7, door_emoji: '🎁' })).toBe('Door 7 🎁 {{nope}}');
  });
  it('unique keys', () => {
    expect(uniqueKey('launch', [{ key: 'launch' }, { key: 'launch_2' }])).toBe('launch_3');
  });
  it('presets and particles', () => {
    expect(matchPreset(['#A855F7', '#38d9f5', '#fbbf24'])?.id).toBe('newyear');
    expect(particlesFor('snowflake', ['#000000', '#111111', '#222222'])).toBe('snow');
    expect(particlesFor('moon', ['#4f46e5', '#14b8a6', '#eab308'])).toBe('none');
  });
  it('toInput strips server fields', () => {
    const input = toInput({ ...advent(), id: 'x', version: 3 } as never);
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('version');
    expect(input.slug).toBe('advent_2026');
  });
});
