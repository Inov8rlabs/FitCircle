import { describe, expect, it } from 'vitest';

import {
  readParseFallbackOptions,
  readParseFallbackOptionsFromJson,
} from '../nutrition-parse-options';

const ID = '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23';

describe('readParseFallbackOptionsFromJson', () => {
  it('absent fields keep the fallback save ON (today\'s behaviour)', () => {
    expect(readParseFallbackOptionsFromJson({ transcript: 'two eggs' })).toEqual({
      skipFallbackSave: false,
      existingEntryId: null,
    });
    expect(readParseFallbackOptionsFromJson(null)).toEqual({
      skipFallbackSave: false,
      existingEntryId: null,
    });
    expect(readParseFallbackOptionsFromJson([])).toEqual({
      skipFallbackSave: false,
      existingEntryId: null,
    });
  });

  it('skip_fallback_save: true switches the save off', () => {
    expect(readParseFallbackOptionsFromJson({ skip_fallback_save: true })).toEqual({
      skipFallbackSave: true,
      existingEntryId: null,
    });
    expect(readParseFallbackOptionsFromJson({ skipFallbackSave: true }).skipFallbackSave).toBe(true);
  });

  it('a false / null / junk flag leaves the save on', () => {
    for (const value of [false, null, 0, 'false', 'no', '', {}, []]) {
      expect(readParseFallbackOptionsFromJson({ skip_fallback_save: value }).skipFallbackSave).toBe(
        false
      );
    }
  });

  it('existing_entry_id switches the save off and is returned lower-cased', () => {
    expect(readParseFallbackOptionsFromJson({ existing_entry_id: ID.toUpperCase() })).toEqual({
      skipFallbackSave: true,
      existingEntryId: ID,
    });
    expect(readParseFallbackOptionsFromJson({ existingEntryId: ID }).existingEntryId).toBe(ID);
  });

  it('a malformed id still prevents a duplicate but is never echoed', () => {
    expect(readParseFallbackOptionsFromJson({ existing_entry_id: 'not-a-uuid' })).toEqual({
      skipFallbackSave: true,
      existingEntryId: null,
    });
  });

  it('an empty / null / non-string id counts as absent', () => {
    for (const value of ['', '   ', null, 42, {}]) {
      expect(readParseFallbackOptionsFromJson({ existing_entry_id: value })).toEqual({
        skipFallbackSave: false,
        existingEntryId: null,
      });
    }
  });
});

describe('readParseFallbackOptions (multipart form fields)', () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return readParseFallbackOptions((key) => fd.get(key));
  };

  it('reads string flags', () => {
    expect(form({ skip_fallback_save: 'true' }).skipFallbackSave).toBe(true);
    expect(form({ skip_fallback_save: '1' }).skipFallbackSave).toBe(true);
    expect(form({ skip_fallback_save: 'TRUE' }).skipFallbackSave).toBe(true);
    expect(form({ skip_fallback_save: 'false' }).skipFallbackSave).toBe(false);
  });

  it('reads the entry id', () => {
    expect(form({ existing_entry_id: ID })).toEqual({ skipFallbackSave: true, existingEntryId: ID });
  });

  it('a form with only images and a note keeps the fallback save on', () => {
    expect(form({ note: 'chicken bowl' })).toEqual({
      skipFallbackSave: false,
      existingEntryId: null,
    });
  });
});
