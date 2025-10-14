import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

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

    let response = NextResponse.json({
      success: true,
      data: {
        message: 'Avatar deleted successfully',
        avatar_url: null,
      },
      error: null,
      meta: null,
    });

    response = await addAutoRefreshHeaders(request, response, user);
    return response;
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
