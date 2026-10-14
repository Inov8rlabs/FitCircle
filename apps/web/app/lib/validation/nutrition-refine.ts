import { z } from 'zod';

import { PHOTO_PARSE_MAX_CORRECTION_CHARS, refineDraftItemSchema, type PhotoRefineRequest } from '../types/nutrition';

const refineDraftSchema = z.array(refineDraftItemSchema).max(40);

/**
 * Parse the optional "fix" fields of a photo-parse request (correction / draft / parseHash form
 * parts). `null` when absent (plain parse), `'invalid'` when present but malformed.
 */
export function readRefineRequest(get: (key: string) => FormDataEntryValue | null): PhotoRefineRequest | null | 'invalid' {
  const rawCorrection = get('correction');
  if (typeof rawCorrection !== 'string') return null;
  const correction = rawCorrection.trim().slice(0, PHOTO_PARSE_MAX_CORRECTION_CHARS);
  if (!correction) return null;
  let items: PhotoRefineRequest['items'] = [];
  const rawDraft = get('draft');
  if (typeof rawDraft === 'string' && rawDraft.trim()) {
    try {
      const parsed = refineDraftSchema.safeParse(JSON.parse(rawDraft));
      if (!parsed.success) return 'invalid';
      items = parsed.data;
    } catch {
      return 'invalid';
    }
  }
  const rawHash = get('parseHash');
  const previousParseHash = typeof rawHash === 'string' && /^[a-f0-9]{16,128}$/i.test(rawHash.trim()) ? rawHash.trim() : null;
  return { correction, items, previousParseHash };
}
