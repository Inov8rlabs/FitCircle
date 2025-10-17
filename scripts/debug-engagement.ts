#!/usr/bin/env node

/**
 * Debug script to check engagement activities for a user
 */

import { createClient } from '@supabase/supabase-js';

// You'll need to set these as environment variables or hardcode them temporarily
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const userId = 'd15217cf-28ec-4d31-bd2c-908330e8993a';

  console.log('=== DEBUGGING ENGAGEMENT ACTIVITIES ===\n');

  // 1. Check daily tracking records
  console.log('1. Daily Tracking Records:');
  const { data: trackingData, error: trackingError } = await supabase
    .from('daily_tracking')
    .select('tracking_date, weight_kg, steps, mood_score')
    .eq('user_id', userId)
    .order('tracking_date', { ascending: false });

  if (trackingError) {
    console.error('Error fetching tracking data:', trackingError);
  } else {
    console.log(`Found ${trackingData?.length || 0} tracking records`);
    trackingData?.forEach(record => {
      console.log(`  - ${record.tracking_date}: weight=${record.weight_kg}, steps=${record.steps}, mood=${record.mood_score}`);
    });
  }

  console.log('\n2. Engagement Activities:');
  const { data: activities, error: activitiesError } = await supabase
    .from('engagement_activities')
    .select('*')
    .eq('user_id', userId)
    .order('activity_date', { ascending: false });

  if (activitiesError) {
    console.error('Error fetching activities:', activitiesError);
  } else {
    console.log(`Found ${activities?.length || 0} engagement activities`);
    activities?.forEach(activity => {
      console.log(`  - ${activity.activity_date}: ${activity.activity_type}`);
    });
  }

  console.log('\n3. Engagement Streak Record:');
  const { data: streakData, error: streakError } = await supabase
    .from('engagement_streaks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (streakError) {
    console.error('Error fetching streak:', streakError);
  } else {
    console.log('Streak data:', JSON.stringify(streakData, null, 2));
  }
}

main().catch(console.error);
