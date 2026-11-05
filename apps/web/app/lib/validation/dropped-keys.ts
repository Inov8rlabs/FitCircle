/**
 * Dropped-key detection for request bodies.
 *
 * zod objects strip keys they do not declare. That is how iOS's `"date"` (the server
 * read `trackingDate`) silently saved every past-day entry as today for 10 months: the
 * request was accepted, the meaningful field vanished, nothing was logged.
 *
 * `findDroppedKeys` lists the keys a request carries that the schema would strip, and
 * `reportDroppedKeys` turns a non-empty list into one structured log line plus a Sentry
 * signal, rate-limited per route + key set. KEY NAMES ONLY, never values.
 *
 * Detection only: nothing here changes what is parsed, accepted or rejected.
 */
import * as Sentry from '@sentry/nextjs';
import type { ZodTypeAny } from 'zod';

type AnyDef = { typeName?: string; [key: string]: unknown };

const MAX_DEPTH = 6;
const MAX_KEYS = 50;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Peel wrappers. A `z.preprocess` is applied to the value on the way in, so a schema
 * that renames an alias key in a preprocess step does not report that alias as dropped.
 */
function unwrapWithValue(schema: ZodTypeAny, value: unknown): { schema: ZodTypeAny; value: unknown } {
  let current = schema;
  let currentValue = value;
  for (let depth = 0; depth < 32; depth++) {
    const def = current._def as AnyDef;
    switch (def.typeName) {
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodDefault':
      case 'ZodCatch':
      case 'ZodBranded':
      case 'ZodReadonly': {
        const inner = (def.innerType ?? def.type) as ZodTypeAny | undefined;
        if (!inner) return { schema: current, value: currentValue };
        current = inner;
        break;
      }
      case 'ZodEffects': {
        const effect = def.effect as { type?: string; transform?: (v: unknown, ctx: unknown) => unknown } | undefined;
        if (effect?.type === 'preprocess' && typeof effect.transform === 'function') {
          try {
            const ctx = { addIssue: () => {}, path: [] as (string | number)[] };
            const out = effect.transform(currentValue, ctx);
            // An async preprocess returns a promise; keep the raw value in that case.
            if (!(out instanceof Promise)) currentValue = out;
          } catch {
            // A preprocess that throws will fail the real parse too; nothing to report.
          }
        }
        current = def.schema as ZodTypeAny;
        break;
      }
      case 'ZodPipeline':
        current = def.in as ZodTypeAny;
        break;
      case 'ZodLazy':
        current = (def.getter as () => ZodTypeAny)();
        break;
      default:
        return { schema: current, value: currentValue };
    }
  }
  return { schema: current, value: currentValue };
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function walk(schema: ZodTypeAny, rawValue: unknown, path: string, depth: number, out: Set<string>): void {
  if (depth > MAX_DEPTH || out.size >= MAX_KEYS) return;
  const { schema: base, value } = unwrapWithValue(schema, rawValue);
  const def = base._def as AnyDef;

  switch (def.typeName) {
    case 'ZodObject': {
      if (!isPlainObject(value)) return;
      const shape = (base as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const catchall = def.catchall as ZodTypeAny | undefined;
      const hasCatchall = catchall !== undefined && (catchall._def as AnyDef).typeName !== 'ZodNever';
      const strips = def.unknownKeys === 'strip' && !hasCatchall;
      for (const [key, fieldValue] of Object.entries(value)) {
        const fieldSchema = shape[key];
        if (fieldSchema) {
          if (fieldValue !== null && typeof fieldValue === 'object') {
            walk(fieldSchema, fieldValue, join(path, key), depth + 1, out);
          }
        } else if (strips) {
          out.add(join(path, key));
        } else if (hasCatchall && fieldValue !== null && typeof fieldValue === 'object') {
          walk(catchall, fieldValue, join(path, key), depth + 1, out);
        }
      }
      return;
    }
    case 'ZodArray': {
      if (!Array.isArray(value)) return;
      const element = def.type as ZodTypeAny;
      for (const item of value) {
        if (item !== null && typeof item === 'object') walk(element, item, `${path}[]`, depth + 1, out);
      }
      return;
    }
    case 'ZodRecord': {
      if (!isPlainObject(value)) return;
      const valueSchema = def.valueType as ZodTypeAny;
      for (const [key, fieldValue] of Object.entries(value)) {
        if (fieldValue !== null && typeof fieldValue === 'object') {
          walk(valueSchema, fieldValue, join(path, key), depth + 1, out);
        }
      }
      return;
    }
    case 'ZodIntersection': {
      // A key is dropped only if neither side declares it.
      const left = new Set<string>();
      const right = new Set<string>();
      walk(def.left as ZodTypeAny, value, path, depth, left);
      walk(def.right as ZodTypeAny, value, path, depth, right);
      for (const key of left) if (right.has(key)) out.add(key);
      return;
    }
    case 'ZodDiscriminatedUnion': {
      if (!isPlainObject(value)) return;
      const discriminator = def.discriminator as string;
      const options = def.optionsMap as Map<unknown, ZodTypeAny> | undefined;
      const option = options?.get(value[discriminator]);
      if (option) walk(option, value, path, depth, out);
      return;
    }
    case 'ZodUnion': {
      // Unknown which branch wins: report only keys that EVERY object branch drops.
      const branches = (def.options as ZodTypeAny[]).filter((option) => {
        const t = (unwrapWithValue(option, value).schema._def as AnyDef).typeName;
        return t === 'ZodObject' || t === 'ZodArray' || t === 'ZodRecord' || t === 'ZodIntersection';
      });
      if (branches.length === 0) return;
      let common: string[] | null = null;
      for (const branch of branches) {
        const found = new Set<string>();
        walk(branch, value, path, depth, found);
        common = common === null ? [...found] : common.filter((key) => found.has(key));
      }
      for (const key of common ?? []) out.add(key);
      return;
    }
    default:
      return;
  }
}

/**
 * Keys present in `value` that `schema` would strip, as dotted paths
 * (`items[].servingUnit`), sorted. Values are never included.
 */
export function findDroppedKeys(schema: ZodTypeAny, value: unknown): string[] {
  const out = new Set<string>();
  try {
    walk(schema, value, '', 0, out);
  } catch {
    // Detection must never break a request.
    return [];
  }
  return [...out].sort().slice(0, MAX_KEYS);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Per instance: log a route+keyset at most once per LOG_WINDOW, Sentry once per SENTRY_WINDOW. */
const LOG_WINDOW_MS = 10 * 60 * 1000;
const SENTRY_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_TRACKED = 500;

const lastLogged = new Map<string, number>();
const lastSentry = new Map<string, number>();

function due(map: Map<string, number>, key: string, windowMs: number, now: number): boolean {
  const last = map.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  if (map.size >= MAX_TRACKED && !map.has(key)) {
    // Evict the oldest entry (Map keeps insertion order; re-set below moves key to the end).
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.delete(key);
  map.set(key, now);
  return true;
}

/** Test hook. */
export function __resetDroppedKeyReportsForTests(): void {
  lastLogged.clear();
  lastSentry.clear();
}

/**
 * Best-effort route of the caller, from the stack: `.../app/api/mobile/tracking/daily/route.ts`
 * (source, tests) or `.../.next/server/app/api/.../route.js` (webpack build) → `/api/mobile/tracking/daily`.
 */
export function routeFromStack(stack: string | undefined = new Error().stack): string {
  if (!stack) return 'unknown';
  const match = /app\/api\/(.+?)\/route\.[cm]?[jt]sx?/.exec(stack.replace(/\\/g, '/'));
  return match ? `/api/${match[1]}` : 'unknown';
}

export interface DroppedKeyOptions {
  /** Route label for the report. Defaults to the caller's route file, from the stack. */
  route?: string;
  /** Keys (dotted paths as reported) a route knowingly ignores; never reported. */
  ignore?: readonly string[];
}

/**
 * Report keys the schema strips from `value`. Never throws, never changes the request.
 * Returns the reported keys (empty when nothing was dropped or all were ignored).
 */
export function reportDroppedKeys(schema: ZodTypeAny, value: unknown, options: DroppedKeyOptions = {}): string[] {
  if (!isPlainObject(value) && !Array.isArray(value)) return [];
  const ignore = new Set(options.ignore ?? []);
  const keys = findDroppedKeys(schema, value).filter((key) => !ignore.has(key));
  if (keys.length === 0) return [];

  try {
    const route = options.route ?? routeFromStack();
    const keyset = keys.join(',');
    const id = `${route}|${keyset}`;
    const now = Date.now();

    Sentry.addBreadcrumb({
      category: 'api-dropped-keys',
      level: 'warning',
      message: `${route}: ${keyset}`,
      data: { route, keys },
    });

    if (due(lastLogged, id, LOG_WINDOW_MS, now)) {
      console.warn('[api-dropped-keys]', JSON.stringify({ route, keys }));
    }
    if (due(lastSentry, id, SENTRY_WINDOW_MS, now)) {
      Sentry.captureMessage(`[api-dropped-keys] ${route}`, {
        level: 'warning',
        tags: { 'api.route': route, 'api.dropped_keys': keyset.slice(0, 200) },
        extra: { route, keys },
        // One Sentry issue per route + key set.
        fingerprint: ['api-dropped-keys', route, keyset],
      });
    }
  } catch {
    // Reporting must never break a request.
  }
  return keys;
}
