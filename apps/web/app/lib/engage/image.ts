/**
 * Image header parsing for asset uploads: PNG / JPEG (lib/campaigns/image-size)
 * plus WebP and GIF. No image library.
 */
import { imageInfo as pngJpegInfo } from '../campaigns/image-size';

export interface AssetImageInfo {
  type: 'png' | 'jpeg' | 'webp' | 'gif';
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  width: number;
  height: number;
  animated: boolean;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export function assetImageInfo(b: Uint8Array): AssetImageInfo | null {
  const base = pngJpegInfo(b);
  if (base) return { ...base, mime: base.type === 'png' ? 'image/png' : 'image/jpeg', animated: false };
  if (b.length >= 10 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) {
    // More than one image descriptor (0x2C after a graphic control block) ≈ animated; NETSCAPE2.0 is the usual tell.
    const animated = b.length > 20 && Buffer.from(b).includes(Buffer.from('NETSCAPE2.0'));
    return { type: 'gif', mime: 'image/gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), animated };
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ') {
      return { type: 'webp', mime: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff, animated: false };
    }
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: 'webp', mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, animated: false };
    }
    if (chunk === 'VP8X') {
      const animated = (b[20] & 0x02) !== 0;
      return {
        type: 'webp',
        mime: 'image/webp',
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        animated,
      };
    }
  }
  return null;
}

export const EXT: Record<AssetImageInfo['type'], string> = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif' };
