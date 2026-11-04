/** Per message / variant stats from ledger rows: rates, holdout lift, variant grouping. */
import { describe, expect, it } from 'vitest';

import { aggregateStats, type StatsRow } from '../stats';

const row = (o: Partial<StatsRow>): StatsRow => ({
  message_key: 'weekly_report',
  channel: 'email',
  status: 'sent',
  variant: 'growth:invite_friend|hero:best_week|subject:best_week_1',
  delivered_at: null,
  opened_at: null,
  clicked_at: null,
  bounced_at: null,
  complained_at: null,
  unsubscribed_at: null,
  converted_at: null,
  meta: {},
  ...o,
});
const t = '2026-11-02T00:00:00Z';

describe('aggregateStats', () => {
  it('counts funnel steps and computes rates + lift against the holdout', () => {
    const rows = [
      row({ delivered_at: t, opened_at: t, clicked_at: t, converted_at: t, meta: { growth_converted_at: t } }),
      row({ delivered_at: t, opened_at: t }),
      row({ delivered_at: t, unsubscribed_at: t, converted_at: t }),
      row({ delivered_at: t }),
      row({ status: 'holdout', converted_at: t }),
      row({ status: 'holdout' }),
      row({ status: 'holdout' }),
      row({ status: 'holdout' }),
      row({ status: 'skipped' }),
    ];
    const [s] = aggregateStats(rows);
    expect(s).toMatchObject({ sent: 4, delivered: 4, opened: 2, clicked: 1, unsubscribed: 1, converted: 2, holdout: 4, holdout_converted: 1, skipped: 1, growth_converted: 1 });
    expect(s).toMatchObject({ delivery_rate: 100, open_rate: 50, click_rate: 25, unsubscribe_rate: 25, conversion_rate: 50, holdout_conversion_rate: 25, lift_pp: 25 });
  });

  it('groups by one variant dimension', () => {
    const rows = [row({}), row({ variant: 'growth:none|hero:quiet|subject:quiet_1' }), row({ variant: 'growth:none|hero:best_week|subject:best_week_2' })];
    expect(aggregateStats(rows, 'hero').map((s) => [s.variant, s.sent])).toEqual([
      ['best_week', 2],
      ['quiet', 1],
    ]);
    expect(aggregateStats(rows, 'growth').map((s) => [s.variant, s.sent])).toEqual([
      ['invite_friend', 1],
      ['none', 2],
    ]);
  });

  it('no denominators → null rates, not 0 %', () => {
    const [s] = aggregateStats([row({ status: 'holdout' })]);
    expect(s.open_rate).toBeNull();
    expect(s.lift_pp).toBeNull();
  });
});
