import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { TemplateService } from '@/lib/services/template-service';
import { z } from 'zod';

const createFromTemplateSchema = z.object({
  template_id: z.string().uuid(),
  fitcircle_id: z.string().uuid(),
});

/**
 * POST /api/mobile/challenges/from-template
 * Create a challenge from a template, copying all template values
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const validated = createFromTemplateSchema.parse(body);

    const challenge = await TemplateService.createFromTemplate(
      validated.template_id,
      validated.fitcircle_id,
      user.id
    );

    return NextResponse.json({
      success: true,
      data: challenge,
      error: null,
    }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid data', details: error.errors } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}
