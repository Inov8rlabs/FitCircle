/** Campaign rows for tests, mirroring the migration 103 seed. */
import type { CampaignRow } from '../../campaigns/model';

const ADVENT_DOORS = [
  ['🚶', 'First steps', 'A 10-minute walk, any pace.'],
  ['💧', 'Water first', 'A glass of water before your first coffee or tea.'],
  ['🧘', 'Unclench', '5 minutes of stretching: neck, shoulders, hips.'],
  ['🥦', 'Add a colour', 'Add one vegetable or fruit to a meal.'],
  ['📵', 'Screen-free bite', 'Eat one meal without your phone.'],
  ['🎅', 'St Nicholas steps', '6,000 steps today.'],
  ['😴', 'Wind down', 'Lights out 20 minutes earlier tonight.'],
  ['🙌', 'Cheer someone', "React to a friend's post in your circle."],
  ['🪜', 'Take the stairs', 'Pick stairs over the lift or escalator today.'],
  ['🍲', 'Cook it', 'Make one meal at home.'],
  ['🌬️', 'Breathe', '2 minutes of slow breathing (4 in, 6 out).'],
  ['🏃', 'Move 20', '20 minutes of any movement you enjoy.'],
  ['🍎', 'Smart snack', 'Swap one snack for fruit or nuts.'],
  ['🧊', 'Hydrate', '8 glasses of water today.'],
  ['🏁', 'Halfway hero', 'Log every meal today.'],
  ['☀️', 'Daylight', '10 minutes outside in daylight.'],
  ['💪', 'Mini workout', '10 squats, 10 push-ups (any version), 20-second plank.'],
  ['🫶', 'Bring a friend', 'Invite one friend to join your circle.'],
  ['🍵', 'Slow sip', 'Swap one sugary drink for water or tea.'],
  ['🎶', 'Dance break', 'One song, full volume, dance it out.'],
  ['🌙', 'Longest night', 'A cosy evening walk under the lights.'],
  ['🥗', 'Plate check', 'Half your plate vegetables at one meal.'],
  ['🎁', 'Gift of steps', 'Walk with someone you love.'],
  ['🎄', 'You made it', 'Check in and share one win from this month.'],
].map(([emoji, title, task], i) => ({ day: i + 1, emoji, title, task }));

let n = 0;
const id = () => `c0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export function baseRow(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: id(),
    slug: `campaign_${n}`,
    template: 'seasonal_circle',
    published: true,
    published_at: '2026-10-16T00:00:00Z',
    archived_at: null,
    title: 'Campaign',
    emoji: '⭐',
    tagline: 'Tagline',
    description: 'Description',
    cta_label: null,
    accent: '#8b5cf6',
    palette: ['#6366f1', '#8b5cf6', '#ec4899'],
    glyph: 'star',
    featured_from: '2026-10-20',
    starts_at: '2026-11-15',
    ends_at: '2026-12-15',
    priority: 0,
    cta: { action: 'start_circle' },
    circle_template: { name: 'Crew', description: 'd', type: 'custom', startDate: '2026-11-15', endDate: '2026-12-15' },
    calendar: null,
    marks: [],
    art: {},
    notifications: [],
    emails: [],
    app_store: {},
    play: {},
    legacy_season_key: null,
    preview_user_ids: [],
    created_by: null,
    updated_by: null,
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T00:00:00Z',
    version: 1,
    ...over,
  };
}

export function holdTheLine(over: Partial<CampaignRow> = {}): CampaignRow {
  return baseRow({
    slug: 'hold_the_line',
    title: 'Hold the Line',
    emoji: '❄️',
    tagline: "Maintain, don't gain — together.",
    description: 'From Nov 15 to Dec 15, your circle checks in daily and heads into the holidays strong. No diets, no guilt: just showing up.',
    accent: '#38bdf8',
    glyph: 'snowflake',
    featured_from: '2026-10-20',
    starts_at: '2026-11-15',
    ends_at: '2026-12-15',
    priority: 0,
    circle_template: {
      name: 'Hold the Line Crew',
      description: "Pre-holiday push. We check in every day and keep each other on track through Dec 15. Maintain, don't gain.",
      type: 'custom',
      startDate: '2026-11-15',
      endDate: '2026-12-15',
    },
    legacy_season_key: 'hold_the_line',
    notifications: [
      { key: 'launch', kind: 'launch', sendOn: null, localHour: 8, title: 'Hold the Line starts today ❄️', body: 'Check in with your crew and head into the holidays strong.', audience: 'all', enabled: true },
    ],
    ...over,
  });
}

export function advent(over: Partial<CampaignRow> = {}): CampaignRow {
  return baseRow({
    slug: 'advent_2026',
    template: 'daily_calendar',
    title: 'Advent Circle',
    emoji: '🎁',
    tagline: 'A small healthy win behind every door.',
    description: 'Open one door a day from Dec 1 to 24: a quick, kind challenge you and your circle do together. Check in each day to open it.',
    accent: '#f59e0b',
    palette: ['#ef4444', '#f59e0b', '#22c55e'],
    glyph: 'gift',
    featured_from: '2026-11-17',
    starts_at: '2026-12-01',
    ends_at: '2026-12-24',
    priority: 20,
    cta: { action: 'open_calendar' },
    circle_template: {
      name: 'Advent Circle',
      description: '24 days, 24 small wins. We check in every day from Dec 1 to Dec 24 and open the doors together.',
      type: 'custom',
      startDate: '2026-12-01',
      endDate: '2026-12-24',
    },
    calendar: { doors: ADVENT_DOORS },
    marks: [
      { date: '2026-12-06', emoji: '🎅', label: 'St Nicholas' },
      { date: '2026-12-24', emoji: '🎄', label: 'Christmas Eve' },
    ],
    notifications: [
      { key: 'launch', kind: 'launch', sendOn: null, localHour: 8, title: 'The Advent Circle is open 🎁', body: 'Door 1 is waiting. Check in today to open it.', audience: 'all', enabled: true },
      { key: 'daily', kind: 'daily', sendOn: null, localHour: 8, title: 'Door {{day}} is open {{door_emoji}}', body: '{{door_title}}: check in today to open it.', audience: 'reminders', enabled: true },
    ],
    ...over,
  });
}

export function freshStart(over: Partial<CampaignRow> = {}): CampaignRow {
  return baseRow({
    slug: 'new_year_reset',
    title: 'Fresh Start 2027',
    emoji: '🌅',
    tagline: 'New year, healthier you. Start it together.',
    description: 'Start 2027 with your people: check in every day for 31 days and build healthy habits that last all year.',
    accent: '#a78bfa',
    glyph: 'year',
    featured_from: '2026-12-16',
    starts_at: '2027-01-01',
    ends_at: '2027-01-31',
    circle_template: {
      name: 'Fresh Start 2027',
      description: 'A fresh year, a fresh start. We check in every day through January and build healthy habits together.',
      type: 'custom',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
    },
    legacy_season_key: 'new_year_reset',
    ...over,
  });
}
