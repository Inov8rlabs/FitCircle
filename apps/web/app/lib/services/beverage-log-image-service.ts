/**
 * Beverage Log Image Service
 *
 * Mirrors FoodLogImageService for the `beverage-logs` storage bucket.
 * Used primarily for alcohol entries (beer labels, cocktail photos) but
 * works for any beverage_logs row.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import { ImageProcessingError, StorageError } from '@/lib/errors/food-log-errors';
import type { BeverageLogImage } from '@/lib/types/beverage-log';

const BUCKET = 'beverage-logs';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export class BeverageLogImageService {
  static async uploadImage(
    beverageLogId: string,
    userId: string,
    file: File,
    displayOrder: number,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; image?: BeverageLogImage; error?: Error }> {
    try {
      this.validateImage(file);

      // Verify ownership
      const { data: entry } = await supabase
        .from('beverage_logs')
        .select('user_id')
        .eq('id', beverageLogId)
        .single();
      if (!entry || entry.user_id !== userId) {
        throw new Error('Not authorized to upload images to this beverage log');
      }

      const imageId = crypto.randomUUID();
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');

      const basePath = `${userId}/${year}/${month}/${beverageLogId}`;
      const originalPath = `${basePath}/${imageId}_original.jpg`;
      const mediumPath = `${basePath}/${imageId}_medium.jpg`;
      const thumbnailPath = `${basePath}/${imageId}_thumbnail.jpg`;

      const buffer = await file.arrayBuffer();
      const image = sharp(Buffer.from(buffer));
      const metadata = await image.metadata();

      const [original, medium, thumbnail] = await Promise.all([
        image.jpeg({ quality: 85 }).toBuffer(),
        image.resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(),
        image.resize(150, 150, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer(),
      ]);

      const uploadResults = await Promise.all([
        supabase.storage.from(BUCKET).upload(originalPath, original, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false,
        }),
        supabase.storage.from(BUCKET).upload(mediumPath, medium, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false,
        }),
        supabase.storage.from(BUCKET).upload(thumbnailPath, thumbnail, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false,
        }),
      ]);

      const uploadError = uploadResults.find((r) => r.error);
      if (uploadError?.error) throw new StorageError(uploadError.error.message);

      const { data: record, error } = await supabase
        .from('beverage_log_images')
        .insert({
          id: imageId,
          beverage_log_id: beverageLogId,
          user_id: userId,
          storage_path: originalPath,
          storage_bucket: BUCKET,
          file_name: file.name,
          file_size_bytes: original.byteLength,
          mime_type: 'image/jpeg',
          width: metadata.width,
          height: metadata.height,
          thumbnail_path: thumbnailPath,
          display_order: displayOrder,
        })
        .select()
        .single();

      if (error) {
        await this.cleanupStorageFiles([originalPath, mediumPath, thumbnailPath], supabase);
        return { success: false, error: new Error(error.message) };
      }

      return { success: true, image: record };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  static async uploadImages(
    beverageLogId: string,
    userId: string,
    files: File[],
    supabase: SupabaseClient
  ): Promise<{
    uploaded: BeverageLogImage[];
    failed: { file_name: string; error: string }[];
  }> {
    if (files.length === 0) return { uploaded: [], failed: [] };

    const { data: existing } = await supabase
      .from('beverage_log_images')
      .select('id', { count: 'exact', head: true })
      .eq('beverage_log_id', beverageLogId)
      .is('deleted_at', null);
    const startOrder = Array.isArray(existing) ? existing.length : 0;

    const uploaded: BeverageLogImage[] = [];
    const failed: { file_name: string; error: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const result = await this.uploadImage(beverageLogId, userId, file, startOrder + i, supabase);
      if (result.success && result.image) uploaded.push(result.image);
      else failed.push({ file_name: file.name, error: result.error?.message ?? 'Unknown error' });
    }
    return { uploaded, failed };
  }

  static async getImagesForEntry(
    beverageLogId: string,
    supabase: SupabaseClient
  ): Promise<{ data: BeverageLogImage[]; error: Error | null }> {
    const { data, error } = await supabase
      .from('beverage_log_images')
      .select('*')
      .eq('beverage_log_id', beverageLogId)
      .is('deleted_at', null)
      .order('display_order', { ascending: true });

    if (error) return { data: [], error: new Error(error.message) };
    return { data: data || [], error: null };
  }

  static async deleteImage(
    imageId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error?: Error }> {
    const { data: image } = await supabase
      .from('beverage_log_images')
      .select('*')
      .eq('id', imageId)
      .is('deleted_at', null)
      .single();

    if (!image || image.user_id !== userId) {
      return { success: false, error: new Error('Not authorized') };
    }

    const mediumPath = image.storage_path.replace('_original.', '_medium.');
    await this.cleanupStorageFiles([image.storage_path, mediumPath, image.thumbnail_path], supabase);

    await supabase
      .from('beverage_log_images')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', imageId);

    return { success: true };
  }

  static async getSignedUrls(
    imageId: string,
    supabase: SupabaseClient
  ): Promise<{ original: string; medium: string; thumbnail: string } | null> {
    const { data: image } = await supabase
      .from('beverage_log_images')
      .select('storage_path, thumbnail_path, storage_bucket')
      .eq('id', imageId)
      .is('deleted_at', null)
      .single();

    if (!image) return null;

    const mediumPath = image.storage_path.replace('_original.', '_medium.');
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
  }

  static addImageUrls(image: BeverageLogImage, baseUrl?: string): BeverageLogImage {
    const apiBase = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://www.fitcircle.ai';
    return {
      ...image,
      url: `${apiBase}/api/mobile/beverages/images/${image.id}?size=medium`,
      original_url: `${apiBase}/api/mobile/beverages/images/${image.id}?size=original`,
      thumbnail_url: `${apiBase}/api/mobile/beverages/images/${image.id}?size=thumbnail`,
    };
  }

  static addImageUrlsToMany(images: BeverageLogImage[], baseUrl?: string): BeverageLogImage[] {
    return images.map((img) => this.addImageUrls(img, baseUrl));
  }

  private static validateImage(file: File): void {
    if (file.size > MAX_BYTES) throw new ImageProcessingError('File size exceeds 10MB limit');
    if (!ALLOWED_TYPES.includes(file.type as typeof ALLOWED_TYPES[number])) {
      throw new ImageProcessingError('Invalid file type. Only JPEG, PNG, WEBP, and HEIC allowed');
    }
  }

  private static async cleanupStorageFiles(paths: string[], supabase: SupabaseClient): Promise<void> {
    try {
      await supabase.storage.from(BUCKET).remove(paths);
    } catch (error) {
      console.error('Beverage image storage cleanup error:', error);
    }
  }
}
