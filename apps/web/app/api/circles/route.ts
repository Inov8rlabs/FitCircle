import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';
import { CreateCircleInput } from '@/app/lib/types/circle';
import { z } from 'zod';

// Validation schema for creating a circle
const createCircleSchema = z.object({
  name: z.string().min(3).max(50),
  description: z.string().max(200).optional(),
  start_date: z.string().refine(date => {
    const startDate = new Date(date);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return startDate >= tomorrow;
  }, 'Start date must be tomorrow or later'),
  end_date: z.string(),
  max_participants: z.number().min(2).max(100).optional(),
  allow_late_join: z.boolean().optional(),
  late_join_deadline: z.number().min(1).max(7).optional(),
}).refine(data => {
  const start = new Date(data.start_date);
  const end = new Date(data.end_date);
  const minDuration = 7 * 24 * 60 * 60 * 1000; // 7 days
  const maxDuration = 365 * 24 * 60 * 60 * 1000; // 365 days
  const duration = end.getTime() - start.getTime();
  return duration >= minDuration && duration <= maxDuration;
}, 'Challenge must be between 7 and 365 days long');

// POST /api/circles - Create a new circle
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = createCircleSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          validation_errors: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          }))
        },
        { status: 400 }
      );
    }

    const input: CreateCircleInput = validation.data;

    // Create circle using service
    const circle = await CircleService.createCircle(user.id, input);

    // Generate invite link
    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://fitcircle.app'}/join/${circle.invite_code}`;

    return NextResponse.json({
      success: true,
      data: {
        circle,
        invite_code: circle.invite_code,
        invite_link: inviteLink,
      }
    });
  } catch (error: any) {
    console.error('Create circle error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create circle' },
      { status: 500 }
    );
  }
}