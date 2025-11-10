/**
 * Food Log Image Service
 *
 * Business logic for image uploads, processing, and management
 */

import { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import type { FoodLogImage } from '@/lib/types/food-log';
import { ImageProcessingError, StorageError } from '@/lib/errors/food-log-errors';

export class FoodLogImageService {
  /**
   * Upload and process image for food log entry
   */
  static async uploadImage(
    entryId: string,
    userId: string,
    file: File,
    displayOrder: number,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; image?: FoodLogImage; error?: Error }> {
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

      // Generate paths
      const imageId = crypto.randomUUID();
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');

      const basePath = `${userId}/${year}/${month}/${entryId}`;
      const originalPath = `${basePath}/${imageId}_original.jpg`;
      const mediumPath = `${basePath}/${imageId}_medium.jpg`;
      const thumbnailPath = `${basePath}/${imageId}_thumbnail.jpg`;

      // Process image
      const buffer = await file.arrayBuffer();
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
          upsert: false,
        }),
        supabase.storage.from(bucket).upload(mediumPath, medium, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false,
        }),
        supabase.storage.from(bucket).upload(thumbnailPath, thumbnail, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: false,
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
        })
        .select()
        .single();

      if (error) {
        // Cleanup storage on error
        await this.cleanupStorageFiles(bucket, [originalPath, mediumPath, thumbnailPath], supabase);
        return { success: false, error: new Error(error.message) };
      }

      // Update parent entry image count
      await supabase.rpc('increment_image_count', { entry_id: entryId });

      // Audit log
      await supabase.from('food_log_audit').insert({
        food_log_entry_id: entryId,
        user_id: userId,
        action: 'image_upload',
        metadata: { image_id: imageId, file_name: file.name },
      });

      return { success: true, image: imageRecord };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
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

      // Update parent entry image count
      await supabase.rpc('decrement_image_count', {
        entry_id: image.food_log_entry_id,
      });

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
