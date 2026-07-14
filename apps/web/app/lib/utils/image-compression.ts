// Client-side photo downscaling for AI food analysis and photo attachment.
// Plate photos need at most ~1568px on the long edge (docs/FOOD-AI-IMPROVEMENT-PLAN.md
// §A1.1): anything larger wastes upload time, server buffering, and vision input tokens.
// Mirrors the mobile clients (iOS ImageProcessor, Android MealImageCompressor).

const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.8;
// Below this size the original is cheap enough to send as-is (and skipping the
// re-encode preserves bytes for the server's content-hash cache).
const SKIP_BELOW_BYTES = 500 * 1024;

/**
 * Downscale an image File to ≤1568px long edge, JPEG q0.8. Best-effort: any failure
 * (unsupported codec such as HEIC in some browsers, decode error) returns the original
 * file — the server accepts it either way.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
      );
      // Only swap in the re-encode when it actually helped.
      if (!blob || blob.size >= file.size) return file;
      const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
      return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

/** Compress several files concurrently, preserving order. */
export function compressImagesForUpload(files: File[]): Promise<File[]> {
  return Promise.all(files.map(compressImageForUpload));
}
