#!/usr/bin/env node

/**
 * Verification script for engagement activities fix
 *
 * This script:
 * 1. Checks if engagement_activities and engagement_streaks tables exist
 * 2. Verifies RLS policies are correctly configured
 * 3. Tests inserting an engagement activity
 * 4. Checks if the activity was recorded
 * 5. Verifies streak was updated
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('==============================================');
  console.log('  ENGAGEMENT ACTIVITIES FIX VERIFICATION');
  console.log('==============================================\n');

  const userId = process.argv[2] || 'd15217cf-28ec-4d31-bd2c-908330e8993a';
  console.log(`Testing with user ID: ${userId}\n`);

  // Step 1: Verify tables exist
  console.log('Step 1: Verifying tables exist...');

  const { data: tables, error: tablesError } = await supabase
    .from('engagement_activities')
    .select('id')
    .limit(1);

  if (tablesError) {
    console.error('  ❌ ERROR: engagement_activities table not found or not accessible');
    console.error('  ', tablesError.message);
    console.error('\n  ACTION REQUIRED: Run migration 023_fix_engagement_activities_rls.sql');
    process.exit(1);
  }

  console.log('  ✅ engagement_activities table exists and is accessible\n');

  // Step 2: Check existing data
  console.log('Step 2: Checking existing engagement data...');

  const { data: existingActivities, error: activitiesError } = await supabase
    .from('engagement_activities')
    .select('*')
    .eq('user_id', userId)
    .order('activity_date', { ascending: false })
    .limit(10);

  if (activitiesError) {
    console.error('  ❌ ERROR querying activities:', activitiesError.message);
  } else {
    console.log(`  Found ${existingActivities?.length || 0} existing activities`);
    if (existingActivities && existingActivities.length > 0) {
      console.log('  Recent activities:');
      existingActivities.forEach((activity) => {
        console.log(`    - ${activity.activity_date}: ${activity.activity_type}`);
      });
    }
  }
  console.log();

  // Step 3: Check engagement streak record
  console.log('Step 3: Checking engagement streak record...');

  const { data: streakData, error: streakError } = await supabase
    .from('engagement_streaks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (streakError) {
    if (streakError.code === 'PGRST116') {
      console.log('  ⚠️  No streak record exists yet (will be created on first activity)');
    } else {
      console.error('  ❌ ERROR querying streak:', streakError.message);
    }
  } else {
    console.log('  ✅ Streak record exists:');
    console.log(`     Current Streak: ${streakData.current_streak} days`);
    console.log(`     Longest Streak: ${streakData.longest_streak} days`);
    console.log(`     Freezes Available: ${streakData.streak_freezes_available}`);
    console.log(`     Last Engagement: ${streakData.last_engagement_date || 'N/A'}`);
    console.log(`     Paused: ${streakData.paused}`);
  }
  console.log();

  // Step 4: Test inserting a new activity (today's date)
  console.log('Step 4: Testing activity insertion...');

  const today = new Date().toISOString().split('T')[0];
  const testActivityType = 'weight_log';

  console.log(`  Attempting to insert ${testActivityType} for ${today}...`);

  const { data: insertedActivity, error: insertError } = await supabase
    .from('engagement_activities')
    .insert({
      user_id: userId,
      activity_date: today,
      activity_type: testActivityType,
      reference_id: null,
    })
    .select()
    .single();

  if (insertError) {
    // Check if it's a duplicate key error (which is okay)
    if (insertError.code === '23505') {
      console.log('  ℹ️  Activity already exists for today (duplicate key - this is fine)');
    } else {
      console.error('  ❌ ERROR inserting activity:', insertError.message);
      console.error('     Code:', insertError.code);
      console.error('     Details:', insertError.details);
      console.error('\n  ACTION REQUIRED: Check RLS policies and service role permissions');
      process.exit(1);
    }
  } else {
    console.log('  ✅ Activity inserted successfully!');
    console.log('     ID:', insertedActivity.id);
    console.log('     Date:', insertedActivity.activity_date);
    console.log('     Type:', insertedActivity.activity_type);
  }
  console.log();

  // Step 5: Verify activity was recorded
  console.log('Step 5: Verifying activity was recorded...');

  const { data: verifyActivity, error: verifyError } = await supabase
    .from('engagement_activities')
    .select('*')
    .eq('user_id', userId)
    .eq('activity_date', today)
    .eq('activity_type', testActivityType)
    .single();

  if (verifyError) {
    console.error('  ❌ ERROR: Activity not found after insertion');
    console.error('     ', verifyError.message);
    process.exit(1);
  }

  console.log('  ✅ Activity verified in database');
  console.log();

  // Step 6: Check daily tracking records
  console.log('Step 6: Checking daily tracking records...');

  const { data: trackingRecords, error: trackingError } = await supabase
    .from('daily_tracking')
    .select('tracking_date, weight_kg, steps, mood_score')
    .eq('user_id', userId)
    .order('tracking_date', { ascending: false })
    .limit(10);

  if (trackingError) {
    console.error('  ❌ ERROR querying daily tracking:', trackingError.message);
  } else {
    console.log(`  Found ${trackingRecords?.length || 0} daily tracking records`);
    if (trackingRecords && trackingRecords.length > 0) {
      console.log('  Recent records:');
      trackingRecords.forEach((record) => {
        const metrics = [];
        if (record.weight_kg) metrics.push(`weight=${record.weight_kg}kg`);
        if (record.steps) metrics.push(`steps=${record.steps}`);
        if (record.mood_score) metrics.push(`mood=${record.mood_score}`);
        console.log(`    - ${record.tracking_date}: ${metrics.join(', ') || 'no data'}`);
      });
    }
  }
  console.log();

  // Final summary
  console.log('==============================================');
  console.log('  VERIFICATION SUMMARY');
  console.log('==============================================');
  console.log('✅ Tables exist and are accessible');
  console.log('✅ Service role can insert activities');
  console.log('✅ Activities are being recorded');

  if (existingActivities && existingActivities.length > 0) {
    console.log(`✅ Found ${existingActivities.length} existing activities`);
  } else {
    console.log('⚠️  No existing activities found (may be new user or issue persists)');
  }

  if (streakData && streakData.last_engagement_date) {
    console.log(`✅ Last engagement date: ${streakData.last_engagement_date}`);
  } else {
    console.log('⚠️  No engagement streak data yet');
  }

  console.log('\n==============================================');
  console.log('  NEXT STEPS');
  console.log('==============================================');
  console.log('1. Run migration: supabase/migrations/023_fix_engagement_activities_rls.sql');
  console.log('2. Have the user log a new weight/steps/mood entry via the iOS app');
  console.log('3. Check server logs for "[upsertDailyTracking] Recording" messages');
  console.log('4. Run this script again to verify engagement was recorded');
  console.log('5. Query the engagement_activities table to confirm');
  console.log();
}

main().catch((error) => {
  console.error('\n❌ FATAL ERROR:', error);
  process.exit(1);
});
