import { describe, expect, it } from 'vitest';

import { isGenericContentType, sniffImageType } from '../image-sniff';

const bytes = (...b: (number | string)[]) =>
  new Uint8Array(b.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe('image sniffing (shipped Android labels beverage photos image/*)', () => {
  it('treats only generic labels as generic', () => {
    for (const t of ['image/*', '', 'application/octet-stream', 'IMAGE/*', null, undefined]) {
      expect(isGenericContentType(t)).toBe(true);
    }
    for (const t of ['image/jpeg', 'image/gif', 'text/plain']) expect(isGenericContentType(t)).toBe(false);
  });

  it('recognises the accepted formats from their first bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp');
    expect(sniffImageType(bytes(0, 0, 0, 0x18, 'ftyp', 'heic'))).toBe('image/heic');
  });

  it('rejects anything else', () => {
    expect(sniffImageType(bytes('GIF89a'))).toBeNull();
    expect(sniffImageType(bytes('%PDF-1.7'))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});
