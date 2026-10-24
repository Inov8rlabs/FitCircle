/**
 * Bid / budget / status change guardrails (docs/ADS_CONSOLE_SPEC.md §8). Pure:
 * the change service loads the entity (re-reading it from the network when
 * stale), then asks here whether the change may proceed. The same rules drive
 * the UI's read-only / editable state via `editability()`.
 */
import { type GuardrailCaps, MIN_BID } from './config';
import type { AdChangeField, AdChannel, AdEntityRow, AdLevel, Editability, FieldEditability, GuardrailCheck, GuardrailRule } from './types';

/** Apple: manual cost-per-tap is the only strategy with settable bids. */
export const APPLE_MANUAL = new Set(['MANUAL_CPT']);
/** Meta ad-set strategies whose bid_amount is a user-set cap/target. */
export const META_MANUAL = new Set(['LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS']);

const SUPPORTED: Record<AdChannel, Record<AdChangeField, AdLevel[]>> = {
  apple_ads: { bid: ['keyword', 'ad_group'], daily_budget: ['campaign'], status: ['campaign', 'ad_group', 'keyword'] },
  meta: { bid: ['ad_group'], daily_budget: ['campaign', 'ad_group'], status: ['campaign', 'ad_group', 'ad'] },
  google_ads: { bid: [], daily_budget: [], status: [] },
};

export function statusValues(channel: AdChannel, level: AdLevel): string[] {
  if (channel === 'apple_ads') return level === 'keyword' ? ['ACTIVE', 'PAUSED'] : ['ENABLED', 'PAUSED'];
  if (channel === 'meta') return ['ACTIVE', 'PAUSED'];
  return [];
}

const LEVEL_NAME: Record<AdLevel, string> = { campaign: 'campaign', ad_group: 'ad group', keyword: 'keyword', ad: 'ad', creative: 'creative' };
const FIELD_NAME: Record<AdChangeField, string> = { bid: 'bid', daily_budget: 'daily budget', status: 'status' };

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function currentValue(entity: Pick<AdEntityRow, 'bid_amount' | 'daily_budget' | 'status'>, field: AdChangeField): number | string | null {
  if (field === 'bid') return toNum(entity.bid_amount);
  if (field === 'daily_budget') return toNum(entity.daily_budget);
  return entity.status ?? null;
}

/** Why a bid is not settable for this strategy, or null when it is manual. */
export function automatedBidReason(channel: AdChannel, bidStrategy: string | null): string | null {
  const s = (bidStrategy ?? '').toUpperCase();
  if (channel === 'apple_ads') {
    if (APPLE_MANUAL.has(s)) return null;
    return s ? `Automated bidding (${s}): Apple sets the bid` : 'Bid strategy unknown: treated as automated';
  }
  if (channel === 'meta') {
    if (META_MANUAL.has(s)) return null;
    if (s === 'LOWEST_COST_WITHOUT_CAP' || !s) return 'Automated bidding (lowest cost, no cap): Meta sets the bid';
    return `Automated bidding (${s}): Meta sets the bid`;
  }
  return 'Channel not supported';
}

/** Structural support for a field on this entity (ignores write access). */
function fieldSupport(entity: AdEntityRow, field: AdChangeField): FieldEditability {
  const levels = SUPPORTED[entity.channel]?.[field] ?? [];
  if (!levels.includes(entity.level)) {
    return { editable: false, reason: `${FIELD_NAME[field]} is not editable on a ${LEVEL_NAME[entity.level]}` };
  }
  if (field === 'bid') {
    const reason = automatedBidReason(entity.channel, entity.bid_strategy);
    if (reason) return { editable: false, reason };
  }
  if (field === 'daily_budget' && toNum(entity.daily_budget) === null) {
    return {
      editable: false,
      reason: entity.channel === 'meta' ? 'No daily budget at this level (campaign budget or lifetime budget)' : 'No daily budget set',
    };
  }
  return { editable: true, reason: null };
}

export function editability(entity: AdEntityRow, access: { configured: boolean; writeEnabled: boolean }): Editability {
  const gate = (f: AdChangeField): FieldEditability => {
    const s = fieldSupport(entity, f);
    if (!s.editable) return s;
    if (!access.configured) return { editable: false, reason: 'Connector not configured' };
    if (!access.writeEnabled) return { editable: false, reason: 'Read-only: enable writes' };
    return s;
  };
  return { bid: gate('bid'), dailyBudget: gate('daily_budget'), status: gate('status') };
}

export interface GuardrailInput {
  entity: AdEntityRow | null;
  field: AdChangeField;
  value: number | string;
  /** The value the user saw when they started the edit (stale check). */
  expectedOldValue?: number | string | null;
  force?: boolean;
  configured: boolean;
  writeEnabled: boolean;
  /** True when the service re-read the entity from the network just now. */
  refreshed: boolean;
  now: number;
  caps: GuardrailCaps;
}

export interface GuardrailResult {
  ok: boolean;
  code: GuardrailRule | 'stale' | null;
  message: string | null;
  checks: GuardrailCheck[];
  oldValue: number | string | null;
  /** The normalised requested value (rounded to cents for money). */
  value: number | string;
  pctChange: number | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateChange(input: GuardrailInput): GuardrailResult {
  const checks: GuardrailCheck[] = [];
  const add = (rule: GuardrailRule, ok: boolean, message: string) => checks.push({ rule, ok, message });
  let staleCode = false;
  const { entity, field, caps } = input;

  if (!entity) {
    add('entity_exists', false, 'Entity not found: sync first');
    return finish(checks, null, input.value, null, false);
  }
  add('entity_exists', true, `${LEVEL_NAME[entity.level]} ${entity.name ?? entity.external_id}`);

  const writable = input.configured && input.writeEnabled;
  add('writable', writable, !input.configured ? 'Connector not configured' : !input.writeEnabled ? 'Read-only: enable writes for this channel' : 'Write access enabled');

  const levels = SUPPORTED[entity.channel]?.[field] ?? [];
  const supported = levels.includes(entity.level);
  add('field_supported', supported, supported ? `${FIELD_NAME[field]} on ${LEVEL_NAME[entity.level]}` : `${FIELD_NAME[field]} is not editable on a ${LEVEL_NAME[entity.level]}`);

  if (field === 'bid') {
    const reason = automatedBidReason(entity.channel, entity.bid_strategy);
    add('manual_bidding', !reason, reason ?? `Manual bidding (${entity.bid_strategy})`);
  }

  const oldValue = currentValue(entity, field);
  let value: number | string = input.value;
  let pctChange: number | null = null;

  if (field === 'status') {
    const allowed = statusValues(entity.channel, entity.level);
    const v = String(input.value ?? '').toUpperCase();
    value = v;
    add('valid_value', allowed.includes(v), allowed.includes(v) ? `Status ${v}` : `Status must be one of ${allowed.join(', ') || '(none)'}`);
    add('no_change', v !== String(oldValue ?? '').toUpperCase(), v === String(oldValue ?? '').toUpperCase() ? `Already ${v}` : `${oldValue ?? '—'} → ${v}`);
  } else {
    const n = toNum(input.value);
    const valid = n !== null && n > 0;
    add('valid_value', valid, valid ? `${money(round2(n))}` : 'Enter a positive amount');
    if (valid) {
      value = round2(n);
      const old = toNum(oldValue);
      add('no_change', old === null || Math.abs(old - (value)) >= 0.005, old !== null && Math.abs(old - (value)) < 0.005 ? 'Same as the current value' : `${old === null ? '—' : money(old)} → ${money(value)}`);
      const [min, max] = field === 'bid' ? [MIN_BID[entity.channel], caps.maxBid] : [caps.minDailyBudget, caps.maxDailyBudget];
      const inBounds = (value) >= min && (value) <= max;
      add('bounds', inBounds, inBounds ? `Within ${money(min)}–${money(max)}` : `${FIELD_NAME[field]} must be between ${money(min)} and ${money(max)}`);
      if (old !== null && old > 0) {
        pctChange = (((value) - old) / old) * 100;
        const within = Math.abs(pctChange) <= caps.maxStepPct + 1e-9;
        if (within) add('step_limit', true, `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(0)}% (limit ±${caps.maxStepPct}%)`);
        else if (input.force) add('step_limit', true, `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(0)}% exceeds ±${caps.maxStepPct}%: forced by admin`);
        else add('step_limit', false, `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(0)}% exceeds the ±${caps.maxStepPct}% step limit (use force to override)`);
      } else {
        add('step_limit', true, 'No previous value to compare');
      }
    }
  }

  // Freshness: synced recently, or re-read just now; and nobody changed it elsewhere.
  const age = input.now - Date.parse(entity.synced_at);
  const fresh = input.refreshed || (Number.isFinite(age) && age < caps.freshnessMs);
  let freshMsg = input.refreshed ? 'Re-read from the network just now' : fresh ? `Synced ${Math.max(0, Math.round(age / 60000))} min ago` : 'Entity data is stale and could not be re-read';
  let freshOk = fresh;
  if (fresh && input.expectedOldValue !== undefined && input.expectedOldValue !== null && !sameValue(input.expectedOldValue, oldValue)) {
    freshOk = false;
    staleCode = true;
    freshMsg = `Changed elsewhere: you saw ${fmtVal(input.expectedOldValue)}, the network now has ${fmtVal(oldValue)}`;
  }
  add('fresh', freshOk, freshMsg);

  return finish(checks, oldValue, value, pctChange, staleCode);
}

function sameValue(a: number | string | null, b: number | string | null): boolean {
  const na = toNum(a);
  const nb = toNum(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.005;
  return String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();
}

const fmtVal = (v: number | string | null) => (typeof v === 'number' ? money(v) : toNum(v) !== null ? money(toNum(v)!) : String(v ?? '—'));

function finish(checks: GuardrailCheck[], oldValue: number | string | null, value: number | string, pctChange: number | null, stale: boolean): GuardrailResult {
  const failed = checks.find((c) => !c.ok) ?? null;
  return {
    ok: !failed,
    code: failed ? (failed.rule === 'fresh' && stale ? 'stale' : failed.rule) : null,
    message: failed?.message ?? null,
    checks,
    oldValue,
    value,
    pctChange,
  };
}
