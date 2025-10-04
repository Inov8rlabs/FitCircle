import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { decode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PhotoProcessRequest {
  userId: string;
  checkInId: string;
  photoBase64: string;
  photoType: 'progress' | 'meal' | 'workout' | 'achievement';
  metadata?: {
    challengeId?: string;
    teamId?: string;
    caption?: string;
    tags?: string[];
  };
}

interface ProcessedPhoto {
  original: string;
  thumbnail: string;
  medium: string;
  large: string;
  metadata: {
    width: number;
    height: number;
    size: number;
    format: string;
    processedAt: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const request: PhotoProcessRequest = await req.json();

    if (!request.userId || !request.checkInId || !request.photoBase64) {
      throw new Error('userId, checkInId, and photoBase64 are required');
    }

    // Decode base64 image
    const photoBuffer = decode(request.photoBase64.replace(/^data:image\/\w+;base64,/, ''));

    // Validate image size (max 10MB)
    if (photoBuffer.length > 10 * 1024 * 1024) {
      throw new Error('Image size exceeds 10MB limit');
    }

    // Get image metadata
    const imageMetadata = await getImageMetadata(photoBuffer);

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${request.userId}/${request.checkInId}/${timestamp}`;

    // Process image into multiple sizes
    const processedImages = await processImage(photoBuffer, imageMetadata);

    // Upload all versions to Supabase Storage
    const uploadPromises = [
      uploadToStorage(supabase, `${filename}_original.${imageMetadata.format}`, processedImages.original),
      uploadToStorage(supabase, `${filename}_thumbnail.${imageMetadata.format}`, processedImages.thumbnail),
      uploadToStorage(supabase, `${filename}_medium.${imageMetadata.format}`, processedImages.medium),
      uploadToStorage(supabase, `${filename}_large.${imageMetadata.format}`, processedImages.large),
    ];

    const uploadResults = await Promise.all(uploadPromises);

    // Get public URLs
    const urls: ProcessedPhoto = {
      original: getPublicUrl(supabase, uploadResults[0].path),
      thumbnail: getPublicUrl(supabase, uploadResults[1].path),
      medium: getPublicUrl(supabase, uploadResults[2].path),
      large: getPublicUrl(supabase, uploadResults[3].path),
      metadata: {
        width: imageMetadata.width,
        height: imageMetadata.height,
        size: photoBuffer.length,
        format: imageMetadata.format,
        processedAt: new Date().toISOString(),
      },
    };

    // Update check-in with photo URLs
    const { data: checkIn, error: checkInError } = await supabase
      .from('check_ins')
      .select('photo_urls')
      .eq('id', request.checkInId)
      .eq('user_id', request.userId)
      .single();

    if (checkInError || !checkIn) {
      throw new Error('Check-in not found or unauthorized');
    }

    const currentPhotoUrls = checkIn.photo_urls || [];
    const updatedPhotoUrls = [...currentPhotoUrls, urls.medium]; // Store medium size as default

    const { error: updateError } = await supabase
      .from('check_ins')
      .update({
        photo_urls: updatedPhotoUrls,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.checkInId)
      .eq('user_id', request.userId);

    if (updateError) {
      throw new Error(`Failed to update check-in: ${updateError.message}`);
    }

    // Store photo metadata in separate table for gallery features
    const { error: photoError } = await supabase
      .from('photos')
      .insert({
        user_id: request.userId,
        check_in_id: request.checkInId,
        challenge_id: request.metadata?.challengeId,
        team_id: request.metadata?.teamId,
        type: request.photoType,
        urls: urls,
        caption: request.metadata?.caption,
        tags: request.metadata?.tags || [],
        metadata: urls.metadata,
        created_at: new Date().toISOString(),
      });

    if (photoError) {
      console.error('Error storing photo metadata:', photoError);
    }

    // If this is a progress photo, perform AI analysis
    if (request.photoType === 'progress') {
      await analyzeProgressPhoto({
        userId: request.userId,
        checkInId: request.checkInId,
        photoUrl: urls.large,
        supabase,
      });
    }

    // Award points for photo upload
    await awardPhotoPoints({
      userId: request.userId,
      checkInId: request.checkInId,
      challengeId: request.metadata?.challengeId,
      supabase,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: urls,
        message: 'Photo processed and uploaded successfully',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error processing photo:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

async function getImageMetadata(buffer: Uint8Array): Promise<{
  width: number;
  height: number;
  format: string;
}> {
  // Simple image format detection
  let format = 'jpg';

  // Check magic bytes for format
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    format = 'png';
  } else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
    format = 'gif';
  } else if (buffer[0] === 0x52 && buffer[1] === 0x49) {
    format = 'webp';
  }

  // For a production system, we'd use a proper image processing library
  // For now, return placeholder dimensions
  return {
    width: 1920,
    height: 1080,
    format,
  };
}

async function processImage(
  buffer: Uint8Array,
  metadata: { width: number; height: number; format: string }
): Promise<{
  original: Uint8Array;
  thumbnail: Uint8Array;
  medium: Uint8Array;
  large: Uint8Array;
}> {
  // In production, use Sharp or ImageMagick for actual image processing
  // For now, return the original buffer for all sizes

  // Thumbnail: 150x150
  const thumbnail = await resizeImage(buffer, 150, 150, metadata);

  // Medium: 600x600 max
  const medium = await resizeImage(buffer, 600, 600, metadata);

  // Large: 1200x1200 max
  const large = await resizeImage(buffer, 1200, 1200, metadata);

  return {
    original: buffer,
    thumbnail,
    medium,
    large,
  };
}

async function resizeImage(
  buffer: Uint8Array,
  maxWidth: number,
  maxHeight: number,
  metadata: { width: number; height: number; format: string }
): Promise<Uint8Array> {
  // Calculate new dimensions maintaining aspect ratio
  const aspectRatio = metadata.width / metadata.height;
  let newWidth = maxWidth;
  let newHeight = maxHeight;

  if (aspectRatio > 1) {
    newHeight = Math.round(maxWidth / aspectRatio);
  } else {
    newWidth = Math.round(maxHeight * aspectRatio);
  }

  // In production, actually resize the image
  // For now, return the original buffer
  return buffer;
}

async function uploadToStorage(
  supabase: any,
  path: string,
  buffer: Uint8Array
): Promise<{ path: string }> {
  const bucketName = Deno.env.get('STORAGE_BUCKET_NAME') || 'fitcircle-media';

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(path, buffer, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload image: ${error.message}`);
  }

  return { path: data.path };
}

function getPublicUrl(supabase: any, path: string): string {
  const bucketName = Deno.env.get('STORAGE_BUCKET_NAME') || 'fitcircle-media';
  const cdnUrl = Deno.env.get('CDN_URL');

  const { data } = supabase.storage.from(bucketName).getPublicUrl(path);

  // Use CDN if configured
  if (cdnUrl) {
    return data.publicUrl.replace(supabase.supabaseUrl, cdnUrl);
  }

  return data.publicUrl;
}

async function analyzeProgressPhoto(params: {
  userId: string;
  checkInId: string;
  photoUrl: string;
  supabase: any;
}): Promise<void> {
  // In production, integrate with computer vision API for body composition analysis
  // For example: Azure Computer Vision, AWS Rekognition, or custom ML model

  try {
    // Placeholder for AI analysis
    const analysis = {
      bodyFatEstimate: null,
      muscleMassEstimate: null,
      postureScore: null,
      suggestions: [],
    };

    // Store analysis results
    await params.supabase
      .from('photo_analysis')
      .insert({
        user_id: params.userId,
        check_in_id: params.checkInId,
        photo_url: params.photoUrl,
        analysis_data: analysis,
        analyzed_at: new Date().toISOString(),
      });
  } catch (error) {
    console.error('Error analyzing progress photo:', error);
  }
}

async function awardPhotoPoints(params: {
  userId: string;
  checkInId: string;
  challengeId?: string;
  supabase: any;
}): Promise<void> {
  const PHOTO_POINTS = 5;

  try {
    // Update check-in points
    const { data: checkIn } = await params.supabase
      .from('check_ins')
      .select('points_earned')
      .eq('id', params.checkInId)
      .single();

    if (checkIn) {
      await params.supabase
        .from('check_ins')
        .update({
          points_earned: (checkIn.points_earned || 0) + PHOTO_POINTS,
        })
        .eq('id', params.checkInId);

      // Update participant points if in a challenge
      if (params.challengeId) {
        await params.supabase.rpc('add_participant_points', {
          p_user_id: params.userId,
          p_challenge_id: params.challengeId,
          p_points: PHOTO_POINTS,
        });
      }
    }
  } catch (error) {
    console.error('Error awarding photo points:', error);
  }
}