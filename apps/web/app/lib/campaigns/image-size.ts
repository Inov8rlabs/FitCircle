/**
 * Minimal PNG / JPEG header parsing (type + pixel dimensions) for art uploads,
 * so App Store slots can require exact sizes without an image library.
 */
export interface ImageInfo {
  type: 'png' | 'jpeg';
  width: number;
  height: number;
}

export function imageInfo(buf: Uint8Array): ImageInfo | null {
  // PNG: 8-byte signature, then the IHDR chunk (width/height big-endian at 16/20).
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a &&
    String.fromCharCode(buf[12], buf[13], buf[14], buf[15]) === 'IHDR'
  ) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return { type: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG: walk the segments to the first SOFn marker.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (buf[i + 5] << 8) | buf[i + 6];
        const width = (buf[i + 7] << 8) | buf[i + 8];
        return { type: 'jpeg', width, height };
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      i += 2 + len;
    }
  }
  return null;
}
