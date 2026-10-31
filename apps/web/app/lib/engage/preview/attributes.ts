/**
 * Attribute catalogue for the segment / audience builders (ENGAGE_SPEC §6):
 * labels, value types and the ops that make sense for each.
 */

import type { AttributeKey, FilterCondition, FilterOp } from '../types';

export type AttrType = 'number' | 'boolean' | 'enum' | 'text';

export interface AttributeMeta {
  key: AttributeKey;
  label: string;
  type: AttrType;
  group: 'Profile' | 'Activity' | 'Social' | 'Device' | 'Rollout';
  options?: readonly string[];
  unit?: string;
  hint?: string;
}

export const ATTRIBUTES: readonly AttributeMeta[] = [
  { key: 'platform', label: 'Platform', type: 'enum', group: 'Device', options: ['ios', 'android', 'web'], hint: 'Last active push-token platform' },
  { key: 'app_version', label: 'App version', type: 'text', group: 'Device' },
  { key: 'push_enabled', label: 'Push enabled', type: 'boolean', group: 'Device' },
  { key: 'email_opt_in', label: 'Email opt-in', type: 'boolean', group: 'Profile' },
  { key: 'days_since_signup', label: 'Days since signup', type: 'number', group: 'Profile', unit: 'days' },
  { key: 'is_pro', label: 'Is Pro', type: 'boolean', group: 'Profile' },
  { key: 'country', label: 'Country', type: 'text', group: 'Profile', hint: 'Best effort, from timezone' },
  { key: 'timezone', label: 'Timezone', type: 'text', group: 'Profile' },
  { key: 'current_streak', label: 'Current streak', type: 'number', group: 'Activity', unit: 'days' },
  { key: 'last_active_days', label: 'Days since last active', type: 'number', group: 'Activity', unit: 'days' },
  { key: 'campaign_joined', label: 'Joined campaign', type: 'text', group: 'Activity', hint: 'Campaign slug' },
  { key: 'active_circle_count', label: 'Active circles', type: 'number', group: 'Social' },
  { key: 'has_active_circle', label: 'Has an active circle', type: 'boolean', group: 'Social' },
  { key: 'referral_qualified_count', label: 'Qualified referrals', type: 'number', group: 'Social' },
  { key: 'random_bucket', label: 'Random bucket (0–99)', type: 'number', group: 'Rollout', hint: 'Stable per user; use < 10 for a 10% rollout' },
];

export const ATTRIBUTE_BY_KEY: Record<AttributeKey, AttributeMeta> = Object.fromEntries(ATTRIBUTES.map((a) => [a.key, a])) as Record<AttributeKey, AttributeMeta>;

export const OP_LABEL: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'is any of',
  not_in: 'is none of',
  exists: 'is set',
  not_exists: 'is not set',
};

export function opsFor(type: AttrType): FilterOp[] {
  switch (type) {
    case 'number':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists'];
    case 'boolean':
      return ['eq'];
    case 'enum':
      return ['eq', 'neq', 'in', 'not_in'];
    default:
      return ['eq', 'neq', 'in', 'not_in', 'exists', 'not_exists'];
  }
}

export function defaultCondition(key: AttributeKey): FilterCondition {
  const meta = ATTRIBUTE_BY_KEY[key];
  if (meta.type === 'boolean') return { key, op: 'eq', value: true };
  if (meta.type === 'number') return { key, op: 'gte', value: 1 };
  if (meta.type === 'enum') return { key, op: 'eq', value: meta.options?.[0] ?? '' };
  return { key, op: 'eq', value: '' };
}

/** Coerces a condition's value to fit its op/type (after the op or key changes). */
export function normalizeCondition(c: FilterCondition): FilterCondition {
  const meta = ATTRIBUTE_BY_KEY[c.key];
  if (!meta) return c;
  if (c.op === 'exists' || c.op === 'not_exists') return { key: c.key, op: c.op, value: null };
  if (c.op === 'in' || c.op === 'not_in') {
    const arr = Array.isArray(c.value) ? c.value : c.value == null || c.value === '' ? [] : [c.value as string | number];
    return { ...c, value: arr.map((v) => (meta.type === 'number' ? Number(v) : String(v))) };
  }
  if (meta.type === 'number') return { ...c, value: Number(Array.isArray(c.value) ? c.value[0] : c.value) || 0 };
  if (meta.type === 'boolean') return { ...c, value: c.value === true || c.value === 'true' };
  return { ...c, value: Array.isArray(c.value) ? String(c.value[0] ?? '') : String(c.value ?? '') };
}

export function conditionValid(c: FilterCondition): boolean {
  const meta = ATTRIBUTE_BY_KEY[c.key];
  if (!meta || !opsFor(meta.type).includes(c.op)) return false;
  if (c.op === 'exists' || c.op === 'not_exists') return true;
  if (c.op === 'in' || c.op === 'not_in') return Array.isArray(c.value) && c.value.length > 0;
  if (meta.type === 'number') return typeof c.value === 'number' && Number.isFinite(c.value);
  if (meta.type === 'boolean') return typeof c.value === 'boolean';
  return typeof c.value === 'string' && c.value.trim().length > 0;
}

/** "Current streak ≥ 7" */
export function describeCondition(c: FilterCondition): string {
  const meta = ATTRIBUTE_BY_KEY[c.key];
  const label = meta?.label ?? c.key;
  if (c.op === 'exists' || c.op === 'not_exists') return `${label} ${OP_LABEL[c.op]}`;
  if (meta?.type === 'boolean') return c.value ? label : `not ${label.toLowerCase()}`;
  const v = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
  return `${label} ${OP_LABEL[c.op]} ${v}${meta?.unit && !Array.isArray(c.value) ? ` ${meta.unit}` : ''}`;
}
