/**
 * Lenient request parsing for the mobile API.
 *
 * Problem: most request schemas declare optional fields with `.optional()`, which
 * accepts an absent key but REJECTS an explicit JSON `null`. Several shipped clients
 * serialize unset values as `null` (kotlinx.serialization with `encodeDefaults`,
 * Swift `Encodable` with optionals encoded explicitly), so a perfectly valid request
 * came back as a 400 VALIDATION_ERROR.
 *
 * `parseLenient` removes a `null` ONLY where the schema would reject it, then parses
 * normally. Where a schema accepts null (`.nullable()` / `.nullish()`, used when null
 * means "clear this field") the null is kept, so clear-semantics are untouched.
 *
 * It never invents values and never loosens any other rule: types, ranges, enums and
 * required fields are validated exactly as before.
 */
import { z, type ZodTypeAny } from 'zod';

type AnyDef = { typeName?: string; [key: string]: unknown };

const WRAPPERS = new Set([
  'ZodOptional',
  'ZodNullable',
  'ZodDefault',
  'ZodCatch',
  'ZodBranded',
  'ZodReadonly',
]);

/** Peel wrappers that do not change the shape of the value being described. */
function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = schema;
  // Bounded loop: schemas are finite, this only guards against a cyclic lazy().
  for (let depth = 0; depth < 32; depth++) {
    const def = current._def as AnyDef;
    const typeName = def.typeName;
    if (typeName && WRAPPERS.has(typeName)) {
      const inner = (def.innerType ?? def.type) as ZodTypeAny | undefined;
      if (!inner) return current;
      current = inner;
    } else if (typeName === 'ZodEffects') {
      current = def.schema as ZodTypeAny;
    } else if (typeName === 'ZodPipeline') {
      current = def.in as ZodTypeAny;
    } else if (typeName === 'ZodLazy') {
      current = (def.getter as () => ZodTypeAny)();
    } else {
      return current;
    }
  }
  return current;
}

function acceptsNull(schema: ZodTypeAny): boolean {
  try {
    return schema.safeParse(null).success;
  } catch {
    // A transform/refinement that throws on null does not accept it.
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Return a copy of `value` without the nulls that `schema` would reject.
 * Unknown keys and values the walker does not understand are returned untouched,
 * so the subsequent `parse` stays the single source of truth.
 */
export function stripRejectedNulls(schema: ZodTypeAny, value: unknown): unknown {
  const base = unwrap(schema);
  const def = base._def as AnyDef;

  if (def.typeName === 'ZodObject' && isPlainObject(value)) {
    const shape = (base as z.ZodObject<z.ZodRawShape>).shape;
    const catchall = def.catchall as ZodTypeAny | undefined;
    const out: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      const fieldSchema: ZodTypeAny | undefined =
        shape[key] ?? ((catchall?._def as AnyDef | undefined)?.typeName !== 'ZodNever' ? catchall : undefined);
      if (!fieldSchema) {
        out[key] = fieldValue; // unknown key: zod strips or passes it through
      } else if (fieldValue === null) {
        if (acceptsNull(fieldSchema)) out[key] = null;
        // else: drop the key, exactly as if the client had omitted it
      } else {
        out[key] = stripRejectedNulls(fieldSchema, fieldValue);
      }
    }
    return out;
  }

  if (def.typeName === 'ZodArray' && Array.isArray(value)) {
    const element = def.type as ZodTypeAny;
    return value.map((item) => (item === null ? item : stripRejectedNulls(element, item)));
  }

  if (def.typeName === 'ZodRecord' && isPlainObject(value)) {
    const valueSchema = def.valueType as ZodTypeAny;
    const out: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      if (fieldValue === null) {
        if (acceptsNull(valueSchema)) out[key] = null;
      } else {
        out[key] = stripRejectedNulls(valueSchema, fieldValue);
      }
    }
    return out;
  }

  if (def.typeName === 'ZodIntersection' && isPlainObject(value)) {
    const left = stripRejectedNulls(def.left as ZodTypeAny, value);
    return stripRejectedNulls(def.right as ZodTypeAny, left);
  }

  // Unions, discriminated unions, tuples, primitives: leave to `parse`.
  return value;
}

/** `schema.parse`, tolerant of explicit nulls for fields that are merely optional. */
export function parseLenient<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(stripRejectedNulls(schema, value));
}

/** `schema.safeParse`, tolerant of explicit nulls for fields that are merely optional. */
export function safeParseLenient<S extends ZodTypeAny>(
  schema: S,
  value: unknown
): z.SafeParseReturnType<z.input<S>, z.infer<S>> {
  return schema.safeParse(stripRejectedNulls(schema, value));
}

/**
 * One readable sentence for a validation failure, for the `message` field of an
 * error response. Clients that cannot render `details` still get something useful.
 */
export function validationMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid request';
  const path = first.path.length > 0 ? first.path.join('.') : 'request';
  const extra = error.issues.length > 1 ? ` (+${error.issues.length - 1} more)` : '';
  return `${path}: ${first.message}${extra}`;
}
