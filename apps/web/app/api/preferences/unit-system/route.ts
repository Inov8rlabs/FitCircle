/**
 * API endpoint for updating user unit system preference
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { PreferenceService } from '@/lib/services/preference-service';
import { UnitSystem } from '@/lib/utils/units';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user's unit system preference
    const unitSystem = await PreferenceService.getUnitSystem(user.id);

    return NextResponse.json({
      unitSystem,
      preferences: await PreferenceService.getUserPreferences(user.id),
    });
  } catch (error: any) {
    console.error('Error fetching unit system:', error);
    return NextResponse.json(
      { error: 'Failed to fetch unit system preference' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { unitSystem } = body;

    // Validate unit system
    if (!unitSystem || !['metric', 'imperial'].includes(unitSystem)) {
      return NextResponse.json(
        { error: 'Invalid unit system. Must be "metric" or "imperial"' },
        { status: 400 }
      );
    }

    // Update preference
    const success = await PreferenceService.updateUnitSystem(
      user.id,
      unitSystem as UnitSystem
    );

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update unit system preference' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      unitSystem,
      message: `Unit system updated to ${unitSystem}`,
    });
  } catch (error: any) {
    console.error('Error updating unit system:', error);
    return NextResponse.json(
      { error: 'Failed to update unit system preference' },
      { status: 500 }
    );
  }
}