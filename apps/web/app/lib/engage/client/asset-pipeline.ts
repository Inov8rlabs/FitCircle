/**
 * Browser asset pipeline (ENGAGE_SPEC §2): validate → SHA-256 (crypto.subtle)
 * → dimensions → dominant colour (16×16 average) → WebP variants at
 * 480/960/1440 (never upscaled; animated GIF keeps the original only).
 * The pure helpers are exported for tests; `processImageFile` needs a browser.
 */

export const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type AcceptedMime = (typeof ACCEPTED_MIME)[number];
export const MAX_BYTES = 10 * 1024 * 1024;
export const MIN_WIDTH = 320;
export const VARIANT_WIDTHS = [480, 960, 1440] as const;

export interface FileCheck {
  ok: boolean;
  error?: string;
}

export function checkFile(f: { type: string; size: number; name?: string }): FileCheck {
  if (!(ACCEPTED_MIME as readonly string[]).includes(f.type)) return { ok: false, error: 'PNG, JPG, WebP or GIF only' };
  if (f.size > MAX_BYTES) return { ok: false, error: `Max 10 MB (this one is ${(f.size / 1024 / 1024).toFixed(1)} MB)` };
  if (f.size === 0) return { ok: false, error: 'Empty file' };
  return { ok: true };
}

export function checkDimensions(width: number, height: number): FileCheck {
  if (!(width > 0 && height > 0)) return { ok: false, error: 'Could not read the image size' };
  if (width < MIN_WIDTH) return { ok: false, error: `At least ${MIN_WIDTH} px wide (this one is ${width} px)` };
  return { ok: true };
}

/** Variant widths for an image: only those strictly narrower than the original. GIFs get none. */
export function variantWidthsFor(width: number, mime: string): number[] {
  if (mime === 'image/gif') return [];
  return VARIANT_WIDTHS.filter((w) => w < width);
}

export function scaledHeight(width: number, height: number, targetWidth: number): number {
  return Math.max(1, Math.round((height * targetWidth) / width));
}

/** Average colour of RGBA pixels, ignoring (mostly) transparent ones. */
export function dominantColorFromPixels(data: ArrayLike<number>): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 16) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (n === 0) return '#1e293b';
  const hx = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

export function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('crypto.subtle is unavailable (needs a secure context)');
  return bufferToHex(await subtle.digest('SHA-256', data));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** File name → readable asset name ("hero_winter-v2.png" → "hero winter v2"). */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
}

// ---------------------------------------------------------------------------
// Browser part
// ---------------------------------------------------------------------------

export interface ProcessedVariant {
  width: number;
  height: number;
  blob: Blob;
}

export interface ProcessedImage {
  file: File;
  name: string;
  mime: AcceptedMime;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  dominantColor: string;
  variants: ProcessedVariant[];
  /** Object URL for instant local preview (revoke when done). */
  previewUrl: string;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall back to <img>
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Not a readable image'));
    img.src = url;
  });
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality));
}

export async function processImageFile(file: File): Promise<ProcessedImage> {
  const check = checkFile(file);
  if (!check.ok) throw new Error(check.error);
  const buf = await file.arrayBuffer();
  const [sha256, img] = await Promise.all([sha256Hex(buf), decode(file)]);
  try {
    const dims = checkDimensions(img.width, img.height);
    if (!dims.ok) throw new Error(dims.error);

    const small = canvas(16, 16);
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) throw new Error('Canvas unavailable');
    sctx.drawImage(img.source, 0, 0, 16, 16);
    const dominantColor = dominantColorFromPixels(sctx.getImageData(0, 0, 16, 16).data);

    const variants: ProcessedVariant[] = [];
    for (const w of variantWidthsFor(img.width, file.type)) {
      const h = scaledHeight(img.width, img.height, w);
      const c = canvas(w, h);
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.source, 0, 0, w, h);
      const blob = await toBlob(c, 'image/webp', 0.86);
      // Browsers without WebP encoding hand back PNG: skip rather than mislabel.
      if (blob.type === 'image/webp') variants.push({ width: w, height: h, blob });
    }

    return {
      file,
      name: nameFromFile(file.name),
      mime: file.type as AcceptedMime,
      sha256,
      width: img.width,
      height: img.height,
      bytes: file.size,
      dominantColor,
      variants,
      previewUrl: URL.createObjectURL(file),
    };
  } finally {
    img.close();
  }
}

/** Files from a drop / paste event (images only). */
export function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files = Array.from(dt.files ?? []);
  if (files.length) return files.filter((f) => f.type.startsWith('image/'));
  return Array.from(dt.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => Boolean(f));
}
