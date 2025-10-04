import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { cookies } from 'next/headers';

// Validation schemas
const checkInSchema = z.object({
  date: z.string(),
  weight: z.number().optional(),
  photos: z.object({
    front: z.string().optional(),
    side: z.string().optional(),
    back: z.string().optional(),
  }).optional(),
  measurements: z.object({
    chest: z.number().optional(),
    waist: z.number().optional(),
    hips: z.number().optional(),
    arms: z.number().optional(),
    thighs: z.number().optional(),
  }).optional(),
  mood: z.enum(['amazing', 'good', 'okay', 'tired', 'stressed']).optional(),
  energy: z.number().min(1).max(10).optional(),
  sleep: z.number().min(0).max(24).optional(),
  water: z.number().min(0).optional(),
  notes: z.string().optional(),
  workouts: z.array(z.object({
    type: z.string(),
    duration: z.number(),
    calories: z.number().optional(),
  })).optional(),
  nutrition: z.object({
    calories: z.number().optional(),
    protein: z.number().optional(),
    carbs: z.number().optional(),
    fat: z.number().optional(),
  }).optional(),
  challengeId: z.string().optional(),
});

// Helper function to get authenticated user
async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = cookies();
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

// GET /api/checkins - Fetch user's check-ins
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

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '100');

    // Build query
    let query = supabase
      .from('checkins')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(limit);

    if (startDate) {
      query = query.gte('date', startDate);
    }

    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Fetch check-ins error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch check-ins' },
        { status: 500 }
      );
    }

    // Calculate streak
    const streak = calculateStreak(data || []);

    return NextResponse.json({
      checkIns: data || [],
      streak: streak,
      total: data?.length || 0,
    });

  } catch (error) {
    console.error('Get check-ins error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/checkins - Create a new check-in
export async function POST(request: NextRequest) {
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
    const validatedData = checkInSchema.parse(body);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if user already has a check-in for this date
    const checkInDate = new Date(validatedData.date);
    checkInDate.setHours(0, 0, 0, 0);
    const checkInDateStr = checkInDate.toISOString().split('T')[0];

    const { data: existingCheckIn } = await supabase
      .from('checkins')
      .select('id')
      .eq('user_id', user.id)
      .eq('date', checkInDateStr)
      .single();

    if (existingCheckIn) {
      return NextResponse.json(
        { error: 'You already have a check-in for this date' },
        { status: 400 }
      );
    }

    // Calculate XP earned based on completeness
    const xpEarned = calculateXP(validatedData);

    // Get current streak
    const { data: allCheckIns } = await supabase
      .from('checkins')
      .select('date')
      .eq('user_id', user.id)
      .order('date', { ascending: false });

    const streakInfo = calculateStreak(allCheckIns || []);

    // Create check-in
    const { data, error } = await supabase
      .from('checkins')
      .insert({
        user_id: user.id,
        date: checkInDateStr,
        weight: validatedData.weight,
        photos: validatedData.photos,
        measurements: validatedData.measurements,
        mood: validatedData.mood,
        energy: validatedData.energy,
        sleep: validatedData.sleep,
        water: validatedData.water,
        notes: validatedData.notes,
        workouts: validatedData.workouts,
        nutrition: validatedData.nutrition,
        challenge_id: validatedData.challengeId,
        xp_earned: xpEarned,
        streak_day: streakInfo.current + 1,
        synced: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Create check-in error:', error);
      return NextResponse.json(
        { error: 'Failed to create check-in' },
        { status: 500 }
      );
    }

    // Update user's total XP
    await updateUserXP(user.id, xpEarned);

    return NextResponse.json({
      checkIn: data,
      message: 'Check-in created successfully!',
      xpEarned: xpEarned,
    }, { status: 201 });

  } catch (error) {
    console.error('Create check-in error:', error);

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

// Helper function to calculate XP based on check-in completeness
function calculateXP(checkIn: any): number {
  let xp = 10; // Base XP for checking in

  if (checkIn.weight) xp += 10;
  if (checkIn.photos?.front) xp += 10;
  if (checkIn.photos?.side) xp += 5;
  if (checkIn.photos?.back) xp += 5;
  if (checkIn.measurements) xp += 15;
  if (checkIn.mood) xp += 5;
  if (checkIn.energy) xp += 5;
  if (checkIn.sleep) xp += 5;
  if (checkIn.water && checkIn.water >= 8) xp += 10;
  if (checkIn.notes) xp += 5;
  if (checkIn.workouts && checkIn.workouts.length > 0) xp += 20;
  if (checkIn.nutrition) xp += 10;

  return xp;
}

// Helper function to calculate streak
function calculateStreak(checkIns: any[]): {
  current: number;
  longest: number;
  lastCheckIn: string | null;
} {
  if (!checkIns || checkIns.length === 0) {
    return { current: 0, longest: 0, lastCheckIn: null };
  }

  // Sort by date descending
  const sorted = [...checkIns].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lastCheckInDate = new Date(sorted[0].date);
  lastCheckInDate.setHours(0, 0, 0, 0);

  const daysDiff = Math.floor((today.getTime() - lastCheckInDate.getTime()) / (1000 * 60 * 60 * 24));

  let currentStreak = 0;
  let longestStreak = 0;

  // Calculate current streak
  if (daysDiff <= 1) {
    currentStreak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const currentDate = new Date(sorted[i - 1].date);
      const prevDate = new Date(sorted[i].date);
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

  // Calculate longest streak
  let tempStreak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const currentDate = new Date(sorted[i - 1].date);
    const prevDate = new Date(sorted[i].date);
    currentDate.setHours(0, 0, 0, 0);
    prevDate.setHours(0, 0, 0, 0);

    const diff = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diff === 1) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 1;
    }
  }

  longestStreak = Math.max(currentStreak, longestStreak);

  return {
    current: currentStreak,
    longest: longestStreak,
    lastCheckIn: sorted[0].date,
  };
}

// Helper function to update user's total XP
async function updateUserXP(userId: string, xpToAdd: number) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get current XP
  const { data: profile } = await supabase
    .from('profiles')
    .select('total_xp, level')
    .eq('id', userId)
    .single();

  const currentXP = profile?.total_xp || 0;
  const newXP = currentXP + xpToAdd;

  // Calculate new level (simple formula: level = floor(XP / 100))
  const newLevel = Math.floor(newXP / 100) + 1;

  // Update profile
  await supabase
    .from('profiles')
    .update({
      total_xp: newXP,
      level: newLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
}