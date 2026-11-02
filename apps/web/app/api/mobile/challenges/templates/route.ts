import { type NextRequest, NextResponse } from 'next/server';

import { iconCompatFor } from '@/lib/design/icon-compat';
import { unhandledChallengeError } from '@/lib/http/circle-challenge-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { TemplateService } from '@/lib/services/template-service';

/**
 * GET /api/mobile/challenges/templates?category=&difficulty=
 * List challenge templates with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    await requireMobileAuth(request);

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const difficulty = searchParams.get('difficulty') || undefined;

    const templates = await TemplateService.listTemplates({
      category,
      difficulty,
      is_active: true,
    });

    return NextResponse.json({
      success: true,
      data: iconCompatFor(request, templates),
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return unhandledChallengeError(error, 'mobile/challenges/templates GET');
  }
}
