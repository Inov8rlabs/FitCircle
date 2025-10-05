import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { cookies } from 'next/headers';

// Validation schema
const profileUpdateSchema = z.object({
  full_name: z.string().min(2).optional(),
  username: z.string().min(3).optional(),
  bio: z.string().max(500).optional(),
  avatar_url: z.string().url().optional(),
  date_of_birth: z.string().optional(),
  height: z.number().min(0).optional(),
  target_weight: z.number().min(0).optional(),
  activity_level: z.enum(['sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active']).optional(),
  goals: z.array(z.string()).optional(),
  preferences: z.object({
    units: z.enum(['metric', 'imperial']).optional(),
    notifications: z.boolean().optional(),
    privacy: z.enum(['public', 'friends', 'private']).optional(),
  }).optional(),
});

// Helper function to get authenticated user
async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('sb-access-token')?.value;

  if (!accessToken) {
    return null;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return user;
}

// GET /api/profile - Get current user's profile
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('Get profile error:', profileError);
      return NextResponse.json(
        { error: 'Failed to fetch profile' },
        { status: 500 }
      );
    }

    // If profile doesn't exist, create it
    if (!profile) {
      const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) {
        console.error('Create profile error:', createError);
        return NextResponse.json(
          { error: 'Failed to create profile' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        profile: newProfile,
      });
    }

    // Get stats
    const { data: stats } = await getProfileStats(user.id);

    return NextResponse.json({
      profile: profile,
      stats: stats,
    });

  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/profile - Update current user's profile
export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = profileUpdateSchema.parse(body);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Update profile
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...validatedData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Update profile error:', error);
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      profile: data,
      message: 'Profile updated successfully!',
    });

  } catch (error) {
    console.error('Update profile error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/profile - Delete account
export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Delete user data in order (to respect foreign key constraints)

    // 1. Delete check-ins
    await supabase
      .from('checkins')
      .delete()
      .eq('user_id', user.id);

    // 2. Delete challenge participations
    await supabase
      .from('challenge_participants')
      .delete()
      .eq('user_id', user.id);

    // 3. Delete team memberships
    await supabase
      .from('team_members')
      .delete()
      .eq('user_id', user.id);

    // 4. Delete profile
    await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id);

    // 5. Delete auth user
    const { error: authError } = await supabase.auth.admin.deleteUser(user.id);

    if (authError) {
      console.error('Delete auth user error:', authError);
      return NextResponse.json(
        { error: 'Failed to delete account' },
        { status: 500 }
      );
    }

    // Clear cookies
    const response = NextResponse.json({
      message: 'Account deleted successfully',
    });

    response.cookies.delete('sb-access-token');
    response.cookies.delete('sb-refresh-token');

    return response;

  } catch (error) {
    console.error('Delete account error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper function to get profile statistics
async function getProfileStats(userId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get check-in stats
  const { data: checkins } = await supabase
    .from('checkins')
    .select('date, weight, xp_earned')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  const totalCheckIns = checkins?.length || 0;

  // Calculate current streak
  let currentStreak = 0;
  if (checkins && checkins.length > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastCheckInDate = new Date(checkins[0].date);
    lastCheckInDate.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((today.getTime() - lastCheckInDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 1) {
      currentStreak = 1;
      for (let i = 1; i < checkins.length; i++) {
        const currentDate = new Date(checkins[i - 1].date);
        const prevDate = new Date(checkins[i].date);
        currentDate.setHours(0, 0, 0, 0);
        prevDate.setHours(0, 0, 0, 0);

        const diff = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diff === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }
  }

  // Get challenge stats
  const { data: challenges } = await supabase
    .from('challenge_participants')
    .select('challenge_id, completed')
    .eq('user_id', userId);

  const activeChallenges = challenges?.filter(c => !c.completed).length || 0;
  const completedChallenges = challenges?.filter(c => c.completed).length || 0;

  // Get team stats
  const { data: teams } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId);

  return {
    totalCheckIns,
    currentStreak,
    activeChallenges,
    completedChallenges,
    teamsJoined: teams?.length || 0,
  };
}