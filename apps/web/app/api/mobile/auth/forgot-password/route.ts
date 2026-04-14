import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { generatePasswordResetToken, storePasswordResetToken } from '@/lib/auth/reset-tokens';
// eslint-disable-next-line import/no-unresolved
import { getUserByEmail } from '@/lib/db/users';
// eslint-disable-next-line import/no-unresolved
import { sendPasswordResetEmail } from '@/lib/email/password-reset';
// eslint-disable-next-line import/no-unresolved
import { logger } from '@/lib/utils/logger';
// eslint-disable-next-line import/no-unresolved
import { rateLimit } from '@/lib/utils/rate-limit';

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

// Rate limit: 3 requests per 15 minutes per email
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    // Rate limiting
    const rateLimitResult = await rateLimiter(request, email);
    if (rateLimitResult) {
      return rateLimitResult;
    }

    // Check if user exists
    const user = await getUserByEmail(email);
    
    // Always return success to prevent email enumeration
    // But only send email if user actually exists
    if (user) {
      // Generate reset token
      const resetToken = generatePasswordResetToken();
      
      // Store token with expiration (1 hour)
      await storePasswordResetToken(user.id, resetToken);
      
      // Send reset email
      await sendPasswordResetEmail(email, resetToken, {
        firstName: user.firstName,
      });

      logger.info('Password reset email sent', { 
        userId: user.id, 
        email: email.replace(/(.{2}).*(@.*)/, '$1***$2') 
      });
    } else {
      logger.info('Password reset requested for non-existent email', { 
        email: email.replace(/(.{2}).*(@.*)/, '$1***$2') 
      });
    }

    return NextResponse.json({
      success: true,
      message: 'If an account with this email exists, a password reset link has been sent.',
    });

  } catch (error) {
    logger.error('Forgot password error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid email address', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Unable to process request' },
      { status: 500 }
    );
  }
}