import { NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { POST as uploadAvatar } from '../../upload/avatar/route';

function avatarError(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details: {}, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status }
  );
}

/**
 * POST /api/mobile/profile/avatar
 *
 * Alias of POST /api/mobile/upload/avatar for the iOS app, which uploads here
 * with the multipart field `avatar` (APIClient.swift `uploadAvatar`) and decodes
 * APIResponse<AvatarUploadResponse>  ->  `data.avatar_url`.
 *
 * The upload itself (type and size checks, storage, profile update) is done by
 * the upload/avatar handler. This route only renames the field to `file` and
 * wraps the result in the standard envelope. The flat `url` / `message` keys of
 * the original response are kept as well.
 */
export async function POST(request: NextRequest) {
  try {
    await requireMobileAuth(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return avatarError(400, 'VALIDATION_ERROR', 'Request body must be multipart/form-data');
    }

    const file = form.get('avatar') ?? form.get('file');
    const forwarded = new FormData();
    if (file instanceof Blob) {
      forwarded.append('file', file, file instanceof File ? file.name : 'avatar.jpg');
    }

    // Same credentials; the multipart content-type (boundary) is set from the new body.
    const headers = new Headers(request.headers);
    headers.delete('content-type');
    headers.delete('content-length');
    const delegated = await uploadAvatar(
      new NextRequest(new URL('/api/mobile/upload/avatar', request.url), {
        method: 'POST',
        headers,
        body: forwarded,
      })
    );

    const result = await delegated.json().catch(() => null);

    if (!delegated.ok || !result?.url) {
      const status = delegated.ok ? 500 : delegated.status;
      const code =
        status === 401 ? 'UNAUTHORIZED' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_SERVER_ERROR';
      return avatarError(status, code, result?.message || 'Avatar upload failed');
    }

    const response = NextResponse.json({
      success: true,
      data: { avatar_url: result.url, url: result.url },
      url: result.url,
      message: result.message ?? 'Avatar uploaded successfully',
      error: null,
      meta: null,
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error: any) {
    console.error('Upload avatar (profile alias) error:', { message: error?.message });

    if (error?.message === 'Unauthorized') {
      return avatarError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    return avatarError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }
}

/**
 * DELETE /api/mobile/profile/avatar
 * Delete user's avatar
 *
 * Actions:
 * - Deletes avatar file from Supabase Storage (if exists)
 * - Sets avatar_url to null in profiles table
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get current avatar URL
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .single();

    const currentAvatarUrl = profile?.avatar_url;

    // Delete from storage if exists
    if (currentAvatarUrl) {
      try {
        // Extract path from URL
        // Example URL: https://iltcscgbmjbizvyepieo.supabase.co/storage/v1/object/public/avatars/user-123/avatar.jpg
        const urlParts = currentAvatarUrl.split('/storage/v1/object/public/');
        if (urlParts.length === 2) {
          const fullPath = urlParts[1]; // e.g., "avatars/user-123/avatar.jpg"
          const pathParts = fullPath.split('/');
          const bucket = pathParts[0]; // "avatars"
          const filePath = pathParts.slice(1).join('/'); // "user-123/avatar.jpg"

          await MobileAPIService.deleteImage(bucket, filePath);
          console.log(`[Delete Avatar] Deleted file from storage: ${filePath}`);
        }
      } catch (storageError) {
        // Log error but don't fail the request
        console.error('[Delete Avatar] Storage deletion error:', storageError);
      }
    }

    // Update profile to remove avatar URL
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        avatar_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log(`[Delete Avatar] Avatar removed for user ${user.id}`);

    const response = NextResponse.json({
      success: true,
      data: {
        message: 'Avatar deleted successfully',
        avatar_url: null,
      },
      error: null,
      meta: null,
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Delete avatar error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
