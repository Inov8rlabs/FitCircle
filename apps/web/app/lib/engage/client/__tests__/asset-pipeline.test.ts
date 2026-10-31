import { describe, expect, it } from 'vitest';

import {
  bufferToHex,
  checkDimensions,
  checkFile,
  dominantColorFromPixels,
  formatBytes,
  nameFromFile,
  scaledHeight,
  sha256Hex,
  variantWidthsFor,
} from '../asset-pipeline';

describe('checkFile', () => {
  it('accepts the four formats up to 10 MB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) expect(checkFile({ type, size: 1000 }).ok).toBe(true);
    expect(checkFile({ type: 'image/svg+xml', size: 10 }).ok).toBe(false);
    expect(checkFile({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }).error).toMatch(/10 MB/);
    expect(checkFile({ type: 'image/png', size: 0 }).ok).toBe(false);
  });
  it('requires ≥ 320 px width', () => {
    expect(checkDimensions(319, 800).ok).toBe(false);
    expect(checkDimensions(320, 10).ok).toBe(true);
    expect(checkDimensions(0, 0).ok).toBe(false);
  });
});

describe('variantWidthsFor', () => {
  it('never upscales', () => {
    expect(variantWidthsFor(2000, 'image/png')).toEqual([480, 960, 1440]);
    expect(variantWidthsFor(1440, 'image/jpeg')).toEqual([480, 960]);
    expect(variantWidthsFor(500, 'image/webp')).toEqual([480]);
    expect(variantWidthsFor(400, 'image/png')).toEqual([]);
  });
  it('keeps GIFs original-only', () => {
    expect(variantWidthsFor(4000, 'image/gif')).toEqual([]);
  });
  it('scales height proportionally', () => {
    expect(scaledHeight(1920, 1080, 480)).toBe(270);
    expect(scaledHeight(1000, 1, 480)).toBe(1);
  });
});

describe('dominantColorFromPixels', () => {
  it('averages opaque pixels and ignores transparent ones', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0]);
    expect(dominantColorFromPixels(px)).toBe('#800080');
  });
  it('falls back when fully transparent', () => {
    expect(dominantColorFromPixels(new Uint8ClampedArray([1, 2, 3, 0]))).toBe('#1e293b');
  });
});

describe('sha256', () => {
  it('hashes bytes with crypto.subtle', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.slice().buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('hex encodes', () => {
    expect(bufferToHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff');
  });
});

describe('misc', () => {
  it('formats sizes and names', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(nameFromFile('hero_winter-v2.PNG')).toBe('hero winter v2');
  });
});
