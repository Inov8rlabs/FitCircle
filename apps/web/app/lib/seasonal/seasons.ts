/**
 * Seasonal circles (REFERRALS_SPEC §10.4) — server-driven so a new season
 * ships without an app release. Dates are calendar days (inclusive start,
 * exclusive-ish end: the circle's end_date = endsAt).
 */

export interface Season {
  key: 'hold_the_line' | 'new_year_reset' | 'ramadan';
  title: string;
  emoji: string;
  tagline: string;
  description: string;
  startsAt: string;
  endsAt: string;
  /** Promoted in the apps from this day until endsAt. */
  featuredFrom: string;
  circle: { name: string; description: string; type: 'custom' | 'step_count' | 'workout_minutes' | 'weight_loss'; startDate: string; endDate: string };
  accent: string;
}

export const SEASONS: readonly Season[] = [
  {
    key: 'hold_the_line',
    title: 'Hold the Line',
    emoji: '❄️',
    tagline: "Maintain, don't gain — together.",
    description:
      'From Nov 15 to Dec 15, your circle checks in daily and heads into the holidays strong. No diets, no guilt: just showing up.',
    startsAt: '2026-11-15',
    endsAt: '2026-12-15',
    featuredFrom: '2026-10-20',
    circle: {
      name: 'Hold the Line Crew',
      description: "Pre-holiday push. We check in every day and keep each other on track through Dec 15. Maintain, don't gain.",
      type: 'custom',
      startDate: '2026-11-15',
      endDate: '2026-12-15',
    },
    accent: '#38bdf8',
  },
  {
    key: 'new_year_reset',
    title: 'Fresh Start',
    emoji: '🌅',
    tagline: 'New year, healthier you. Start it together.',
    description: 'Start 2027 with your people: check in every day for 31 days and build healthy habits that last all year.',
    startsAt: '2027-01-01',
    endsAt: '2027-01-31',
    featuredFrom: '2026-12-15',
    circle: {
      name: 'Fresh Start 2027',
      description: 'A fresh year, a fresh start. We check in every day through January and build healthy habits together.',
      type: 'custom',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
    },
    accent: '#a78bfa',
  },
  {
    key: 'ramadan',
    title: 'Ramadan Circle',
    emoji: '🌙',
    tagline: 'Suhoor, iftar and a gentle walk, together.',
    description:
      'Around Feb 8 to Mar 9, 2027 (dates follow the moon sighting). Log suhoor and iftar, stay hydrated, and take an evening walk with your circle.',
    startsAt: '2027-02-08',
    endsAt: '2027-03-09',
    featuredFrom: '2027-01-25',
    circle: {
      name: 'Ramadan Circle',
      description: 'Suhoor, iftar, water and an evening walk. We keep each other gentle and consistent through Ramadan.',
      type: 'custom',
      startDate: '2027-02-08',
      endDate: '2027-03-09',
    },
    accent: '#34d399',
  },
];

/** The promoted season for `today` (YYYY-MM-DD), and the next one after it. */
export function seasonsFor(today: string): { current: Season | null; upcoming: Season | null } {
  const current = SEASONS.find((s) => s.featuredFrom <= today && today <= s.endsAt) ?? null;
  const upcoming = SEASONS.filter((s) => s.featuredFrom > today).sort((a, b) => a.featuredFrom.localeCompare(b.featuredFrom))[0] ?? null;
  return { current, upcoming };
}
