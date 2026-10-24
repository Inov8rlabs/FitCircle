import { describe, expect, it } from 'vitest';

import { guardrailCaps } from '../config';
import { automatedBidReason, editability, evaluateChange, type GuardrailInput } from '../guardrails';
import type { AdEntityRow } from '../types';

const NOW = Date.parse('2026-10-24T12:00:00Z');

const keyword = (over: Partial<AdEntityRow> = {}): AdEntityRow => ({
  channel: 'apple_ads',
  platform: 'ios',
  level: 'keyword',
  external_id: '2360029480',
  parent_external_id: '2152121621',
  campaign_external_id: '2144950391',
  name: 'calorie counter',
  status: 'ACTIVE',
  serving_status: null,
  bid_strategy: 'MANUAL_CPT',
  bid_amount: '2',
  bid_currency: 'USD',
  daily_budget: null,
  total_budget: null,
  match_type: 'EXACT',
  countries: null,
  start_at: null,
  end_at: null,
  creative: null,
  synced_at: new Date(NOW - 5 * 60_000).toISOString(),
  ...over,
});

const campaign = (over: Partial<AdEntityRow> = {}) => keyword({ level: 'campaign', external_id: '2144950391', parent_external_id: null, name: 'US Search', status: 'ENABLED', bid_amount: null, daily_budget: 50, ...over });

const input = (over: Partial<GuardrailInput> = {}): GuardrailInput => ({
  entity: keyword(),
  field: 'bid',
  value: 2.5,
  configured: true,
  writeEnabled: true,
  refreshed: false,
  now: NOW,
  caps: guardrailCaps(),
  ...over,
});

const rule = (r: ReturnType<typeof evaluateChange>, name: string) => r.checks.find((c) => c.rule === name);

describe('evaluateChange', () => {
  it('passes a sane manual keyword bid change', () => {
    const r = evaluateChange(input());
    expect(r.ok).toBe(true);
    expect(r.code).toBeNull();
    expect(r.oldValue).toBe(2);
    expect(r.value).toBe(2.5);
    expect(r.pctChange).toBeCloseTo(25);
  });

  it('1. entity must exist', () => {
    const r = evaluateChange(input({ entity: null }));
    expect(r).toMatchObject({ ok: false, code: 'entity_exists' });
  });

  it('1. connector configured with write access', () => {
    expect(evaluateChange(input({ writeEnabled: false }))).toMatchObject({ ok: false, code: 'writable' });
    expect(evaluateChange(input({ configured: false }))).toMatchObject({ ok: false, code: 'writable' });
  });

  it('2. bids only where bidding is manual', () => {
    const r = evaluateChange(input({ entity: keyword({ bid_strategy: 'MAXIMIZE_CONVERSIONS' }) }));
    expect(r).toMatchObject({ ok: false, code: 'manual_bidding' });
    expect(rule(r, 'manual_bidding')?.message).toMatch(/Automated/);
    const meta = keyword({ channel: 'meta', level: 'ad_group', bid_strategy: 'COST_CAP', bid_amount: 3.5 });
    expect(evaluateChange(input({ entity: meta, value: 4 })).ok).toBe(true);
    expect(evaluateChange(input({ entity: { ...meta, bid_strategy: 'LOWEST_COST_WITHOUT_CAP' }, value: 4 })).code).toBe('manual_bidding');
    expect(automatedBidReason('meta', 'LOWEST_COST_WITH_BID_CAP')).toBeNull();
    expect(automatedBidReason('meta', 'LOWEST_COST_WITH_MIN_ROAS')).toBeNull();
  });

  it('field must be supported on the level', () => {
    expect(evaluateChange(input({ entity: campaign(), field: 'bid', value: 1 })).code).toBe('field_supported');
    expect(evaluateChange(input({ field: 'daily_budget', value: 10 })).code).toBe('field_supported');
  });

  it('3. bounds: Apple min bid $0.10, max ADS_MAX_BID_USD (default $10)', () => {
    const low = keyword({ bid_amount: 0.15 });
    expect(evaluateChange(input({ entity: low, value: 0.09 })).code).toBe('bounds');
    expect(evaluateChange(input({ entity: low, value: 0.1 })).ok).toBe(true);
    expect(evaluateChange(input({ entity: keyword({ bid_amount: 9 }), value: 10.5 })).code).toBe('bounds');
    process.env.ADS_MAX_BID_USD = '12';
    try {
      expect(evaluateChange(input({ entity: keyword({ bid_amount: 9 }), value: 10.5, caps: guardrailCaps() })).ok).toBe(true);
    } finally {
      delete process.env.ADS_MAX_BID_USD;
    }
  });

  it('3. bounds: daily budget $1 … ADS_MAX_DAILY_BUDGET_USD (default $200)', () => {
    expect(evaluateChange(input({ entity: campaign({ daily_budget: 1.5 }), field: 'daily_budget', value: 0.99 })).code).toBe('bounds');
    expect(evaluateChange(input({ entity: campaign({ daily_budget: 180 }), field: 'daily_budget', value: 201 })).code).toBe('bounds');
    expect(evaluateChange(input({ entity: campaign(), field: 'daily_budget', value: 60 })).ok).toBe(true);
  });

  it('4. step limit ±50% unless forced (and forced is recorded in the check)', () => {
    const r = evaluateChange(input({ value: 3.01 }));
    expect(r.code).toBe('step_limit');
    const forced = evaluateChange(input({ value: 3.01, force: true }));
    expect(forced.ok).toBe(true);
    expect(rule(forced, 'step_limit')?.message).toMatch(/forced/);
    expect(evaluateChange(input({ value: 3 })).ok).toBe(true); // exactly +50%
    expect(evaluateChange(input({ value: 0.99 })).code).toBe('step_limit'); // −50.5%
  });

  it('5. freshness: stale + not re-read → rejected; re-read → ok', () => {
    const old = keyword({ synced_at: new Date(NOW - 20 * 60_000).toISOString() });
    expect(evaluateChange(input({ entity: old })).code).toBe('fresh');
    expect(evaluateChange(input({ entity: old, refreshed: true })).ok).toBe(true);
  });

  it('5. stale: remote value differs from what the user saw', () => {
    const r = evaluateChange(input({ expectedOldValue: 1.5 }));
    expect(r).toMatchObject({ ok: false, code: 'stale' });
    expect(evaluateChange(input({ expectedOldValue: '2.00' })).ok).toBe(true);
  });

  it('rejects no-op and invalid values', () => {
    expect(evaluateChange(input({ value: 2 })).code).toBe('no_change');
    expect(evaluateChange(input({ value: 'abc' })).code).toBe('valid_value');
    expect(evaluateChange(input({ value: -1 })).code).toBe('valid_value');
  });

  it('status changes use the channel/level vocabulary', () => {
    expect(evaluateChange(input({ field: 'status', value: 'paused' })).ok).toBe(true);
    expect(evaluateChange(input({ field: 'status', value: 'ENABLED' })).code).toBe('valid_value'); // keywords are ACTIVE/PAUSED
    expect(evaluateChange(input({ entity: campaign(), field: 'status', value: 'PAUSED' })).ok).toBe(true);
    expect(evaluateChange(input({ field: 'status', value: 'ACTIVE' })).code).toBe('no_change');
  });

  it('rounds money to cents', () => {
    expect(evaluateChange(input({ value: 2.456 })).value).toBe(2.46);
  });
});

describe('editability', () => {
  const access = { configured: true, writeEnabled: true };
  it('manual keyword: bid + status editable, no budget', () => {
    const e = editability(keyword(), access);
    expect(e.bid.editable).toBe(true);
    expect(e.status.editable).toBe(true);
    expect(e.dailyBudget.editable).toBe(false);
  });
  it('automated: read-only bid with the reason', () => {
    const e = editability(keyword({ bid_strategy: 'MAXIMIZE_CONVERSIONS' }), access);
    expect(e.bid).toEqual({ editable: false, reason: 'Automated bidding (MAXIMIZE_CONVERSIONS): Apple sets the bid' });
  });
  it('writes disabled → hint to enable writes', () => {
    expect(editability(campaign(), { configured: true, writeEnabled: false }).dailyBudget).toEqual({ editable: false, reason: 'Read-only: enable writes' });
  });
  it('Meta ad set under campaign budget: no ad-set budget', () => {
    const e = editability(keyword({ channel: 'meta', level: 'ad_group', bid_strategy: 'COST_CAP', daily_budget: null }), access);
    expect(e.dailyBudget.editable).toBe(false);
    expect(e.bid.editable).toBe(true);
  });
});
