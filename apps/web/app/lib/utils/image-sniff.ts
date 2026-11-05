/**
 * Identify an uploaded image from its first bytes, for clients that label the
 * multipart part with a generic type (shipped Android beverage photos use
 * `image/*`). Only the formats the upload routes accept are recognised.
 */
export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

/** Content types that say "some file" rather than which image format it is. */
export function isGenericContentType(type: string | null | undefined): boolean {
  const t = (type ?? '').trim().toLowerCase();
  return t === '' || t === 'image/*' || t === 'image' || t === 'application/octet-stream';
}

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (start: number, end: number) => String.fromCharCode(...b.slice(start, end));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) {
    return 'image/heic';
  }
  return null;
}
