import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { TemplateService } from '@/lib/services/template-service';

/**
 * GET /api/mobile/challenges/templates/[id]
 * Get a single template by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireMobileAuth(request);
    const { id } = await params;

    const template = await TemplateService.getTemplate(id);

    return NextResponse.json({
      success: true,
      data: template,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    if (error.message === 'Template not found') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Template not found' } },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}
