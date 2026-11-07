/**
 * Remote config registry (docs/TRIAL_FIRST_SPEC.md §6). Keys, types, bounds and code
 * defaults live here: adding a key needs a deploy, changing a value (Admin Tools →
 * remote_config_defaults / remote_config_rules) does not.
 *
 * Types: `int` (bounded integer), `enum` (one of `options`), `string_list` (array of
 * strings matching `itemPattern`, at most `maxItems`). Server-side only: no client
 * endpoint serves these values.
 *
 * Premium abuse ceilings are deliberately NOT here (lib/config/tier-limits.ts).
 */

export type RemoteConfigType = 'int' | 'enum' | 'string_list';

export type RemoteConfigValue = number | string | string[];

interface KeyDefBase {
  unit: string;
  description: string;
}

export interface IntKeyDef extends KeyDefBase {
  type: 'int';
  /** Served when no rule matches and no admin default is set (or both are invalid). */
  default: number;
  min: number;
  max: number;
}

export interface EnumKeyDef extends KeyDefBase {
  type: 'enum';
  default: string;
  options: readonly string[];
}

export interface StringListKeyDef extends KeyDefBase {
  type: 'string_list';
  default: readonly string[];
  maxItems: number;
  /** Every item must match this (RegExp source, anchored). */
  itemPattern: string;
}

export type RemoteConfigKeyDef = IntKeyDef | EnumKeyDef | StringListKeyDef;

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const REMOTE_CONFIG_REGISTRY = {
  free_food_ai_analyses_total: {
    type: 'int',
    default: 5,
    min: 0,
    max: 1000,
    unit: 'analyses (lifetime)',
    description: 'Lifetime AI food analyses (photo, voice, describe, Fix, estimate-item) for non-paying users. Pro / trial users only have the daily abuse ceiling.',
  },
  free_fitzy_messages_per_day: {
    type: 'int',
    default: 0,
    min: 0,
    max: 200,
    unit: 'messages/day',
    description: 'Fitzy chat messages per UTC day for non-paying users. 0 = chat requires Pro or a free trial (the first message opens the paywall).',
  },
  integrity_enforce_android: {
    type: 'enum',
    default: 'block',
    options: ['block', 'log', 'off'],
    unit: 'mode',
    description:
      'Android app-integrity checks for clients that declare integrity_v1. block = a failing device gets 403 INTEGRITY_FAILED; log = verify and record but allow; off = skip verification.',
  },
  integrity_bypass_user_ids: {
    type: 'string_list',
    default: [],
    maxItems: 200,
    itemPattern: UUID_PATTERN,
    unit: 'user ids',
    description: 'Internal test accounts allowed to sign in and stay signed in (login + refresh only) from builds that fail the Android integrity check.',
  },
} as const satisfies Record<string, RemoteConfigKeyDef>;

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_REGISTRY;

type KeysOfType<T extends RemoteConfigType> = {
  [K in RemoteConfigKey]: (typeof REMOTE_CONFIG_REGISTRY)[K]['type'] extends T ? K : never;
}[RemoteConfigKey];

export type IntConfigKey = KeysOfType<'int'>;
export type EnumConfigKey = KeysOfType<'enum'>;
export type ListConfigKey = KeysOfType<'string_list'>;

export const REMOTE_CONFIG_KEYS = Object.keys(REMOTE_CONFIG_REGISTRY) as RemoteConfigKey[];

export function isRemoteConfigKey(key: string): key is RemoteConfigKey {
  return Object.prototype.hasOwnProperty.call(REMOTE_CONFIG_REGISTRY, key);
}

export function keyDef(key: RemoteConfigKey): RemoteConfigKeyDef {
  return REMOTE_CONFIG_REGISTRY[key];
}

/** The code default as a plain value (lists are copied). */
export function codeDefault(key: RemoteConfigKey): RemoteConfigValue {
  const def = keyDef(key);
  return def.type === 'string_list' ? [...def.default] : def.default;
}

/** Validate a value against the key's type + bounds. Returns the value or null when invalid. */
export function validValue(key: RemoteConfigKey, value: unknown): RemoteConfigValue | null {
  const def = keyDef(key);
  if (def.type === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < def.min || value > def.max) return null;
    return value;
  }
  if (def.type === 'enum') {
    return typeof value === 'string' && def.options.includes(value) ? value : null;
  }
  if (!Array.isArray(value) || value.length > def.maxItems) return null;
  const re = new RegExp(def.itemPattern);
  if (!value.every((v) => typeof v === 'string' && re.test(v))) return null;
  return [...(value as string[])];
}

/** Human message for an invalid value (400 responses). */
export function valueError(key: RemoteConfigKey): string {
  const def = keyDef(key);
  if (def.type === 'enum') return `Expected one of: ${def.options.join(', ')}`;
  if (def.type === 'string_list') return `Expected an array of at most ${def.maxItems} strings matching ${def.itemPattern}`;
  return `Expected an integer between ${def.min} and ${def.max}`;
}
