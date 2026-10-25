import { describe, expect, it } from 'vitest';

import { externalChangeRows } from '../external-changes';
import type { AdEntityInput, AdEntityRow } from '../types';

const row = (over: Partial<AdEntityRow>): AdEntityRow =>
  ({ channel: 'apple_ads', level: 'keyword', external_id: 'K1', bid_amount: 2, daily_budget: null, status: 'ACTIVE', ...over }) as AdEntityRow;
const input = (over: Partial<AdEntityInput>): AdEntityInput =>
  ({ channel: 'apple_ads', level: 'keyword', externalId: 'K1', campaignExternalId: 'C1', name: 'calorie counter', bidAmount: 2, dailyBudget: null, status: 'ACTIVE', ...over }) as AdEntityInput;

describe('externalChangeRows', () => {
  it('logs a bid changed in the network UI as an applied external change', () => {
    const rows = externalChangeRows([row({ bid_amount: '2' as unknown as number })], [input({ bidAmount: 4 })]);
    expect(rows).toEqual([
      expect.objectContaining({ field: 'bid', old_value: '2.00', new_value: '4.00', outcome: 'applied', actor_email: null, entity_name: 'calorie counter', checks: { source: 'external' } }),
    ]);
  });

  it('logs budget and status changes; nothing when unchanged', () => {
    const rows = externalChangeRows(
      [row({ level: 'campaign', external_id: 'C1', bid_amount: null, daily_budget: 50, status: 'ENABLED' })],
      [input({ level: 'campaign', externalId: 'C1', bidAmount: null, dailyBudget: 75, status: 'PAUSED' })]
    );
    expect(rows.map((r) => [r.field, r.old_value, r.new_value])).toEqual([
      ['daily_budget', '50.00', '75.00'],
      ['status', 'ENABLED', 'PAUSED'],
    ]);
    expect(externalChangeRows([row({})], [input({})])).toEqual([]);
  });

  it('new entities (first sync) are not changes', () => {
    expect(externalChangeRows([], [input({ bidAmount: 9 })])).toEqual([]);
  });
});
