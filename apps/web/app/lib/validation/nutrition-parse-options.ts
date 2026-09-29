/**
 * Optional "do not create a fallback entry" controls for the AI parse routes
 * (`POST /api/mobile/food/photo-parse`, `POST /api/mobile/food/voice-parse`).
 *
 * Background ("Option B"): when a parse fails or is rate-limited the routes save the
 * raw input as a NEW unparsed food-log entry so the user's photo / note is never lost.
 * That is right for a brand-new log, but wrong when the client is
 *   - re-running the AI on an entry that is ALREADY saved,
 *   - adding a photo to an existing meal, or
 *   - only prefilling a form it will save itself,
 * because every failure then leaves a duplicate entry behind.
 *
 * Two optional request fields switch the fallback save off. Both are accepted in
 * snake_case and camelCase, as JSON values (voice-parse) or form fields (photo-parse):
 *
 *   skip_fallback_save: true        → a failure creates nothing.
 *   existing_entry_id: "<uuid>"     → a failure creates nothing, and the error's
 *                                     `details.savedEntryId` is that id when the entry
 *                                     belongs to the caller.
 *
 * When neither field is sent the routes behave exactly as before.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ParseFallbackOptions {
  /** True when a failed parse must NOT create a new food-log entry. */
  skipFallbackSave: boolean;
  /**
   * The entry the client says it is working on, lower-cased, when it sent a
   * well-formed uuid. Ownership is NOT checked here — the route must verify it
   * against the authenticated user before echoing it.
   */
  existingEntryId: string | null;
}

export const DEFAULT_PARSE_FALLBACK_OPTIONS: ParseFallbackOptions = {
  skipFallbackSave: false,
  existingEntryId: null,
};

function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  return false;
}

function firstPresent(read: (key: string) => unknown, keys: string[]): unknown {
  for (const key of keys) {
    const value = read(key);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Read the two optional fields through `read` (a JSON property getter or
 * `FormData.get`). Never throws: a malformed value is simply not honoured as an id.
 *
 * Any non-empty `existing_entry_id` — even a malformed one — switches the fallback
 * save off: the client has told us an entry already exists, so creating another one
 * can only ever produce the duplicate this option is there to prevent.
 */
export function readParseFallbackOptions(read: (key: string) => unknown): ParseFallbackOptions {
  const rawId = firstPresent(read, ['existing_entry_id', 'existingEntryId']);
  const idText = typeof rawId === 'string' ? rawId.trim() : '';
  const hasExistingEntry = idText.length > 0;

  const skipFlag = isTruthyFlag(firstPresent(read, ['skip_fallback_save', 'skipFallbackSave']));

  return {
    skipFallbackSave: skipFlag || hasExistingEntry,
    existingEntryId: UUID_RE.test(idText) ? idText.toLowerCase() : null,
  };
}

/** Convenience for a parsed JSON body (anything that is not a plain object reads as empty). */
export function readParseFallbackOptionsFromJson(body: unknown): ParseFallbackOptions {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return DEFAULT_PARSE_FALLBACK_OPTIONS;
  }
  const record = body as Record<string, unknown>;
  return readParseFallbackOptions((key) => record[key]);
}
