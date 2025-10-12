import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

/**
 * POST /api/mobile/upload/checkin-photo
 * Upload check-in progress photo
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

    // Validate file size (max 10MB for check-in photos)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: 'File too large',
          message: 'Check-in photo must be less than 10MB',
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
    const filePath = `checkin-photos/${filename}`;

    // Upload to Supabase Storage
    const publicUrl = await MobileAPIService.uploadImage(
      'checkin-photos',
      filePath,
      buffer,
      file.type
    );

    return NextResponse.json({
      success: true,
      url: publicUrl,
      message: 'Check-in photo uploaded successfully',
    });
  } catch (error: any) {
    console.error('Upload check-in photo error:', error);

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
