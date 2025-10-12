import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

/**
 * POST /api/mobile/upload/avatar
 * Upload user avatar image
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        {
          error: 'No file provided',
          message: 'Please provide a file to upload',
        },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error: 'Invalid file type',
          message: 'Only JPEG, PNG, WEBP, and HEIC images are allowed',
        },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: 'File too large',
          message: 'Avatar image must be less than 5MB',
        },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop() || 'jpg';
    const filename = `${user.id}_${timestamp}.${fileExtension}`;
    const filePath = `avatars/${filename}`;

    // Upload to Supabase Storage
    const publicUrl = await MobileAPIService.uploadImage(
      'avatars',
      filePath,
      buffer,
      file.type
    );

    // Update user profile with new avatar URL
    await MobileAPIService.updateUserProfile(user.id, {
      avatar_url: publicUrl,
    });

    return NextResponse.json({
      success: true,
      url: publicUrl,
      message: 'Avatar uploaded successfully',
    });
  } catch (error: any) {
    console.error('Upload avatar error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
