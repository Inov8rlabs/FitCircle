import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

// Validation schema
const refreshSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = refreshSchema.parse(body);

    // Refresh the access token
    const tokens = await MobileAPIService.refreshAccessToken(validatedData.refresh_token);

    if (!tokens) {
      return NextResponse.json(
        {
          error: 'Invalid refresh token',
          message: 'The refresh token is invalid or has expired',
        },
        { status: 401 }
      );
    }

    // Return new token pair
    return NextResponse.json({
      success: true,
      session: tokens,
    });
  } catch (error) {
    console.error('Mobile refresh error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: 'Invalid input data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
