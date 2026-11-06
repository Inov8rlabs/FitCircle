/**
 * Remote config registry (docs/TRIAL_FIRST_SPEC.md §6). Keys, types, bounds and code
 * defaults live here: adding a key needs a deploy, changing a value (Admin Tools →
 * remote_config_defaults / remote_config_rules) does not.
 *
 * Premium abuse ceilings are deliberately NOT here (lib/config/tier-limits.ts).
 */

export type RemoteConfigType = 'int';

export interface RemoteConfigKeyDef {
  type: RemoteConfigType;
  /** Served when no rule matches and no admin default is set (or both are invalid). */
  default: number;
  min: number;
  max: number;
  unit: string;
  description: string;
}

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
} as const satisfies Record<string, RemoteConfigKeyDef>;

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_REGISTRY;

export const REMOTE_CONFIG_KEYS = Object.keys(REMOTE_CONFIG_REGISTRY) as RemoteConfigKey[];

export function isRemoteConfigKey(key: string): key is RemoteConfigKey {
  return Object.prototype.hasOwnProperty.call(REMOTE_CONFIG_REGISTRY, key);
}

export function keyDef(key: RemoteConfigKey): RemoteConfigKeyDef {
  return REMOTE_CONFIG_REGISTRY[key];
}

/** Validate a value against the key's type + bounds. Returns the value or null when invalid. */
export function validValue(key: RemoteConfigKey, value: unknown): number | null {
  const def = keyDef(key);
  if (def.type === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < def.min || value > def.max) return null;
    return value;
  }
  return null;
}

/** Human message for an invalid value (400 responses). */
export function valueError(key: RemoteConfigKey): string {
  const def = keyDef(key);
  return `Expected an integer between ${def.min} and ${def.max}`;
}
