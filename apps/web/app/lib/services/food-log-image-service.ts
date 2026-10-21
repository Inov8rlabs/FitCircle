/**
 * Food Log Image Service
 *
 * Business logic for image uploads, processing, and management
 */

import { createHash, randomUUID } from 'crypto';

import { type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import { ImageProcessingError, StorageError } from '@/lib/errors/food-log-errors';
import type { FoodLogImage } from '@/lib/types/food-log';

import { CircleMealPostService } from './circle-meal-post-service';

/** A client-supplied per-file idempotency key: 1–128 chars of [A-Za-z0-9._:-]. */
const IMAGE_KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Same shape as the list endpoint's per-entry photo fields. */
export interface EntryPhotoUrls {
  /** First image (back-compat). Only present when the entry has images. */
  photo_url?: string;
  /** Every live image, ordered by display_order (medium size). */
  image_urls: string[];
}

export class FoodLogImageService {
  static isValidImageKey(key: unknown): key is string {
    return typeof key === 'string' && IMAGE_KEY_RE.test(key);
  }

  /**
   * The batch endpoint's optional per-file `image_keys` form values: none →
   * undefined (content-hash dedupe); otherwise exactly one valid key per file,
   * either as repeated fields or one JSON array string ('' / null = no key).
   */
  static parseImageKeys(
    values: string[],
    fileCount: number
  ): { keys?: (string | undefined)[]; error?: string } {
    let raw = values;
    if (raw.length === 0) return {};
    if (raw.length === 1 && raw[0].trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(raw[0]);
        if (!Array.isArray(parsed)) return { error: 'image_keys must be an array' };
        raw = parsed.map((k) => (k == null ? '' : String(k)));
      } catch {
        return { error: 'image_keys is not valid JSON' };
      }
    }
    if (raw.length !== fileCount) {
      return { error: `image_keys has ${raw.length} values for ${fileCount} images` };
    }
    const keys = raw.map((k) => (k === '' ? undefined : k));
    if (keys.some((k) => k !== undefined && !this.isValidImageKey(k))) {
      return { error: 'Each image key must be 1-128 characters of A-Z a-z 0-9 . _ : -' };
    }
    return { keys };
  }

  /**
   * The image row id for an upload, derived from the entry and the upload's key —
   * so a retried upload of the same file maps to the same row (primary key) and
   * is recognised instead of stored twice. The key is the client's `image_key`
   * when sent, else the SHA-256 of the file's bytes.
   */
  static deterministicImageId(entryId: string, key: string): string {
    // uuid ids are case-insensitive (iOS sends uppercase, Postgres reads back lowercase).
    const b = createHash('sha256').update(`food-log-image:${entryId.toLowerCase()}:${key}`).digest();
    b[6] = (b[6] & 0x0f) | 0x50; // version nibble (name-based)
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = b.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** The live image row with this id on this entry, if any. */
  private static async findLiveImage(
    imageId: string,
    entryId: string,
    supabase: SupabaseClient
  ): Promise<{ image: FoodLogImage | null; softDeleted: boolean }> {
    const { data } = await supabase
      .from('food_log_images')
      .select('*')
      .eq('id', imageId)
      .maybeSingle();
    // Compare as uuids: the path id may be uppercase (iOS), the column reads back lowercase.
    if (!data || String(data.food_log_entry_id).toLowerCase() !== entryId.toLowerCase()) {
      return { image: null, softDeleted: false };
    }
    if (data.deleted_at) return { image: null, softDeleted: true };
    return { image: data as FoodLogImage, softDeleted: false };
  }

  /**
   * Upload and process image for food log entry.
   *
   * Idempotent per entry + key (`opts.imageKey`, else the file's content hash):
   * re-uploading the same file returns the stored image with `duplicate: true`
   * and changes nothing (no new row, no image_count bump, no audit row).
   */
  static async uploadImage(
    entryId: string,
    userId: string,
    file: File,
    displayOrder: number,
    supabase: SupabaseClient,
    opts: { imageKey?: string } = {}
  ): Promise<{ success: boolean; image?: FoodLogImage; error?: Error; duplicate?: boolean; imageKey?: string }> {
    try {
      // Validate file
      this.validateImage(file);

      // Verify entry ownership
      const { data: entry } = await supabase
        .from('food_log_entries')
        .select('user_id')
        .eq('id', entryId)
        .single();

      if (!entry || entry.user_id !== userId) {
        throw new Error('Not authorized to upload images to this entry');
      }

      // Read the bytes once: they're hashed for the idempotency key and processed below.
      const buffer = await file.arrayBuffer();
      const imageKey =
        opts.imageKey ?? `sha256:${createHash('sha256').update(Buffer.from(buffer)).digest('hex')}`;

      // Retry of an upload that already landed → hand back the stored image.
      let imageId = this.deterministicImageId(entryId, imageKey);
      const prior = await this.findLiveImage(imageId, entryId, supabase);
      if (prior.image) return { success: true, image: prior.image, duplicate: true, imageKey };
      // The same photo was attached before and then removed: this is a fresh attach.
      if (prior.softDeleted) imageId = randomUUID();
      const deterministic = !prior.softDeleted;

      // Generate paths
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');

      const basePath = `${userId}/${year}/${month}/${entryId}`;
      const originalPath = `${basePath}/${imageId}_original.jpg`;
      const mediumPath = `${basePath}/${imageId}_medium.jpg`;
      const thumbnailPath = `${basePath}/${imageId}_thumbnail.jpg`;

      // Process image
      const image = sharp(Buffer.from(buffer));
      const metadata = await image.metadata();

      // Generate versions
      const [original, medium, thumbnail] = await Promise.all([
        image.jpeg({ quality: 85 }).toBuffer(),
        image
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer(),
        image.resize(150, 150, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer(),
      ]);

      // Upload to storage
      const bucket = 'food-logs';
      const uploadResults = await Promise.all([
        supabase.storage.from(bucket).upload(originalPath, original, {
          contentType: 'image/jpeg',
          cacheControl: '31536000', // 1 year
          // Deterministic paths: an earlier attempt may have stored the files but not the row.
          upsert: deterministic,
        }),
        supabase.storage.from(bucket).upload(mediumPath, medium, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: deterministic,
        }),
        supabase.storage.from(bucket).upload(thumbnailPath, thumbnail, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: deterministic,
        }),
      ]);

      // Check for upload errors
      const uploadError = uploadResults.find(r => r.error);
      if (uploadError?.error) {
        throw new StorageError(uploadError.error.message);
      }

      // Create database record
      const { data: imageRecord, error } = await supabase
        .from('food_log_images')
        .insert({
          id: imageId,
          food_log_entry_id: entryId,
          user_id: userId,
          storage_path: originalPath,
          storage_bucket: bucket,
          file_name: file.name,
          file_size_bytes: original.byteLength,
          mime_type: 'image/jpeg',
          width: metadata.width,
          height: metadata.height,
          thumbnail_path: thumbnailPath,
          display_order: displayOrder,
          metadata: { image_key: imageKey },
        })
        .select()
        .single();

      if (error) {
        // A concurrent retry of the same upload won the insert: return its row.
        if (error.code === POSTGRES_UNIQUE_VIOLATION && deterministic) {
          const winner = await this.findLiveImage(imageId, entryId, supabase);
          if (winner.image) {
            // Same id → same paths, unless the winner ran in another month.
            if (winner.image.storage_path !== originalPath) {
              await this.cleanupStorageFiles(bucket, [originalPath, mediumPath, thumbnailPath], supabase);
            }
            return { success: true, image: winner.image, duplicate: true, imageKey };
          }
        }
        // Cleanup storage on error
        await this.cleanupStorageFiles(bucket, [originalPath, mediumPath, thumbnailPath], supabase);
        return { success: false, error: new Error(error.message) };
      }

      // Update parent entry image count - using direct update instead of RPC
      const { data: entryData } = await supabase
        .from('food_log_entries')
        .select('image_count')
        .eq('id', entryId)
        .single();
      
      await supabase
        .from('food_log_entries')
        .update({ 
          image_count: (entryData?.image_count || 0) + 1,
          has_images: true 
        })
        .eq('id', entryId);

      // Photos upload after the entry row exists, so the chat meal card was
      // created without one. Fill it in now (fire-and-forget, never throws).
      if ((entryData?.image_count || 0) === 0) {
        void CircleMealPostService.onMealPhotoAttached(entryId, imageId);
      }

      // Audit log
      await supabase.from('food_log_audit').insert({
        food_log_entry_id: entryId,
        user_id: userId,
        action: 'image_upload',
        metadata: { image_id: imageId, file_name: file.name, image_key: imageKey },
      });

      return { success: true, image: imageRecord, duplicate: false, imageKey };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Upload multiple images to a single entry in one call. Each upload is
   * processed independently — partial success is possible. The returned
   * payload describes which files succeeded and which failed.
   *
   * Idempotent: each file is keyed by `imageKeys[i]` when given, else by its
   * content hash, so retrying a batch whose response was lost returns the
   * stored images (`duplicates`) instead of attaching them twice.
   *
   * `display_order` is auto-assigned starting from the current image_count
   * on the entry, in the order the files are provided (duplicates don't take
   * a slot).
   */
  static async uploadImages(
    entryId: string,
    userId: string,
    files: File[],
    supabase: SupabaseClient,
    imageKeys?: (string | undefined)[]
  ): Promise<{
    uploaded: (FoodLogImage & { image_key?: string; duplicate?: boolean })[];
    failed: { file_name: string; error: string; image_key?: string }[];
    duplicates: number;
  }> {
    if (files.length === 0) return { uploaded: [], failed: [], duplicates: 0 };

    // Snapshot the starting display_order so the batch lays out in order
    // even if a sibling upload happens mid-flight.
    const { data: entry } = await supabase
      .from('food_log_entries')
      .select('image_count')
      .eq('id', entryId)
      .single();
    const startOrder = entry?.image_count ?? 0;

    const uploaded: (FoodLogImage & { image_key?: string; duplicate?: boolean })[] = [];
    const failed: { file_name: string; error: string; image_key?: string }[] = [];
    let created = 0;
    let duplicates = 0;

    // Serialize per file: parallelism here can race the image_count update
    // and produce duplicate display_orders.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const clientKey = imageKeys?.[i];
      const result = await this.uploadImage(entryId, userId, file, startOrder + created, supabase, {
        imageKey: clientKey,
      });
      if (result.success && result.image) {
        if (result.duplicate) duplicates++;
        else created++;
        uploaded.push({
          ...result.image,
          image_key: result.imageKey,
          ...(result.duplicate ? { duplicate: true } : {}),
        });
      } else {
        failed.push({
          file_name: file.name,
          error: result.error?.message ?? 'Unknown error',
          ...(clientKey ? { image_key: clientKey } : {}),
        });
      }
    }
    return { uploaded, failed, duplicates };
  }

  /**
   * Attach `photo_url` / `image_urls` to entries — the shape GET /food-log
   * returns — reading images only for entries that have any. With
   * `alwaysIncludeList`, entries without images get `image_urls: []` (create /
   * PATCH responses, so a client can tell "no photos" from "not reported").
   */
  static async withPhotoUrls<T extends { id: string; has_images?: boolean | null; image_count?: number | null }>(
    entries: T[],
    supabase: SupabaseClient,
    apiBase: string,
    opts: { alwaysIncludeList?: boolean } = {}
  ): Promise<(T & Partial<EntryPhotoUrls>)[]> {
    const withImages = entries.filter((e) => e.has_images && (e.image_count ?? 0) > 0);

    const idsByEntry = new Map<string, string[]>();
    if (withImages.length > 0) {
      const { data: images } = await supabase
        .from('food_log_images')
        .select('id, food_log_entry_id, display_order')
        .in('food_log_entry_id', withImages.map((e) => e.id))
        .is('deleted_at', null)
        .order('display_order', { ascending: true });

      for (const img of images || []) {
        const list = idsByEntry.get(img.food_log_entry_id) ?? [];
        list.push(img.id);
        idsByEntry.set(img.food_log_entry_id, list);
      }
    }

    return entries.map((entry) => {
      const ids = idsByEntry.get(entry.id) ?? [];
      if (ids.length === 0) return opts.alwaysIncludeList ? { ...entry, image_urls: [] } : entry;
      const image_urls = ids.map((id) => `${apiBase}/api/mobile/food-log/images/${id}?size=medium`);
      return {
        ...entry,
        photo_url: image_urls[0], // back-compat: first image
        image_urls, // full ordered list for carousels
      };
    });
  }

  /**
   * Get images for a food log entry
   */
  static async getImagesForEntry(
    entryId: string,
    supabase: SupabaseClient
  ): Promise<{ data: FoodLogImage[]; error: Error | null }> {
    try {
      const { data: images, error } = await supabase
        .from('food_log_images')
        .select('*')
        .eq('food_log_entry_id', entryId)
        .is('deleted_at', null)
        .order('display_order', { ascending: true });

      if (error) {
        return { data: [], error: new Error(error.message) };
      }

      return { data: images || [], error: null };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get images for multiple food log entries with signed URLs
   * Returns a map of entry_id -> images array
   */
  static async getImagesForEntries(
    entryIds: string[],
    supabase: SupabaseClient
  ): Promise<{ data: Record<string, FoodLogImage[]>; error: Error | null }> {
    try {
      if (entryIds.length === 0) {
        return { data: {}, error: null };
      }

      const { data: images, error } = await supabase
        .from('food_log_images')
        .select('*')
        .in('food_log_entry_id', entryIds)
        .is('deleted_at', null)
        .order('display_order', { ascending: true });

      if (error) {
        return { data: {}, error: new Error(error.message) };
      }

      // Group images by entry ID and add signed URLs
      const imagesByEntry: Record<string, FoodLogImage[]> = {};
      
      if (images && images.length > 0) {
        // Generate signed URLs for all images
        const imagesWithUrls = await Promise.all(
          images.map(async (image) => {
            const mediumPath = image.storage_path.replace('_original.', '_medium.');
            
            const [thumbnailUrl, mediumUrl] = await Promise.all([
              supabase.storage.from(image.storage_bucket).createSignedUrl(image.thumbnail_path, 3600),
              supabase.storage.from(image.storage_bucket).createSignedUrl(mediumPath, 3600),
            ]);

            return {
              ...image,
              thumbnail_url: thumbnailUrl.data?.signedUrl || '',
              url: mediumUrl.data?.signedUrl || '',
            };
          })
        );

        // Group by entry ID
        for (const image of imagesWithUrls) {
          const entryId = image.food_log_entry_id;
          if (!imagesByEntry[entryId]) {
            imagesByEntry[entryId] = [];
          }
          imagesByEntry[entryId].push(image);
        }
      }

      return { data: imagesByEntry, error: null };
    } catch (error) {
      return {
        data: {},
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get signed URLs for image access
   */
  static async getSignedUrls(
    imageId: string,
    supabase: SupabaseClient
  ): Promise<{
    original: string;
    medium: string;
    thumbnail: string;
  } | null> {
    try {
      const { data: image } = await supabase
        .from('food_log_images')
        .select('storage_path, thumbnail_path, storage_bucket')
        .eq('id', imageId)
        .is('deleted_at', null)
        .single();

      if (!image) return null;

      const mediumPath = image.storage_path.replace('_original.', '_medium.');

      // Generate signed URLs (valid for 1 hour)
      const [originalUrl, mediumUrl, thumbnailUrl] = await Promise.all([
        supabase.storage.from(image.storage_bucket).createSignedUrl(image.storage_path, 3600),
        supabase.storage.from(image.storage_bucket).createSignedUrl(mediumPath, 3600),
        supabase.storage.from(image.storage_bucket).createSignedUrl(image.thumbnail_path, 3600),
      ]);

      return {
        original: originalUrl.data?.signedUrl || '',
        medium: mediumUrl.data?.signedUrl || '',
        thumbnail: thumbnailUrl.data?.signedUrl || '',
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete image and cleanup storage
   */
  static async deleteImage(
    imageId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error?: Error }> {
    try {
      // Get image record
      const { data: image } = await supabase
        .from('food_log_images')
        .select('*')
        .eq('id', imageId)
        .is('deleted_at', null)
        .single();

      if (!image || image.user_id !== userId) {
        return { success: false, error: new Error('Not authorized') };
      }

      // Delete from storage
      const mediumPath = image.storage_path.replace('_original.', '_medium.');
      await this.cleanupStorageFiles(
        image.storage_bucket,
        [image.storage_path, mediumPath, image.thumbnail_path],
        supabase
      );

      // Soft delete record
      await supabase
        .from('food_log_images')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', imageId);

      // Update parent entry image count - using direct update instead of RPC
      const { data: entry } = await supabase
        .from('food_log_entries')
        .select('image_count')
        .eq('id', image.food_log_entry_id)
        .single();
      
      const newCount = Math.max(0, (entry?.image_count || 1) - 1);
      await supabase
        .from('food_log_entries')
        .update({ 
          image_count: newCount,
          has_images: newCount > 0 
        })
        .eq('id', image.food_log_entry_id);

      // Audit log
      await supabase.from('food_log_audit').insert({
        food_log_entry_id: image.food_log_entry_id,
        user_id: userId,
        action: 'image_delete',
        metadata: { image_id: imageId },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Update image display order
   */
  static async updateDisplayOrder(
    imageId: string,
    userId: string,
    displayOrder: number,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error?: Error }> {
    try {
      // Verify ownership
      const { data: image } = await supabase
        .from('food_log_images')
        .select('user_id')
        .eq('id', imageId)
        .single();

      if (!image || image.user_id !== userId) {
        return { success: false, error: new Error('Not authorized') };
      }

      const { error } = await supabase
        .from('food_log_images')
        .update({ display_order: displayOrder, updated_at: new Date().toISOString() })
        .eq('id', imageId)
        .eq('user_id', userId);

      if (error) {
        return { success: false, error: new Error(error.message) };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  // Private helpers

  private static validateImage(file: File): void {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

    if (file.size > maxSize) {
      throw new ImageProcessingError('File size exceeds 10MB limit');
    }

    if (!allowedTypes.includes(file.type)) {
      throw new ImageProcessingError(
        'Invalid file type. Only JPEG, PNG, WEBP, and HEIC allowed'
      );
    }
  }

  private static async cleanupStorageFiles(
    bucket: string,
    paths: string[],
    supabase: SupabaseClient
  ): Promise<void> {
    try {
      await supabase.storage.from(bucket).remove(paths);
    } catch (error) {
      console.error('Storage cleanup error:', error);
    }
  }

  /**
   * Add API URLs to image records
   * This transforms storage paths into full API URLs that go through our proxy
   */
  static addImageUrls(image: FoodLogImage, baseUrl?: string): FoodLogImage {
    // Use provided baseUrl or try to get from environment
    const apiBase = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://www.fitcircle.ai';

    return {
      ...image,
      url: `${apiBase}/api/mobile/food-log/images/${image.id}?size=medium`,
      original_url: `${apiBase}/api/mobile/food-log/images/${image.id}?size=original`,
      thumbnail_url: `${apiBase}/api/mobile/food-log/images/${image.id}?size=thumbnail`,
    };
  }

  /**
   * Add API URLs to multiple images
   */
  static addImageUrlsToMany(images: FoodLogImage[], baseUrl?: string): FoodLogImage[] {
    return images.map(image => this.addImageUrls(image, baseUrl));
  }
}
