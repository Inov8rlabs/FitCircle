-- Test script to verify progress functions work
-- Run this in Supabase SQL Editor to test the functions

-- First, let's check if the functions exist
SELECT
    proname as function_name,
    pg_get_function_identity_arguments(oid) as arguments
FROM pg_proc
WHERE proname IN ('get_user_circles_with_progress', 'get_participant_progress', 'get_progress_history');

-- Test get_user_circles_with_progress
SELECT 'Testing get_user_circles_with_progress...' as test_name;
SELECT COUNT(*) as circle_count FROM get_user_circles_with_progress();

-- Test get_participant_progress (you'll need to replace with an actual challenge_id)
-- SELECT 'Testing get_participant_progress...' as test_name;
-- SELECT COUNT(*) as participant_count FROM get_participant_progress('your-challenge-id-here'::uuid);

-- Test get_progress_history (you'll need to replace with actual IDs)
-- SELECT 'Testing get_progress_history...' as test_name;
-- SELECT COUNT(*) as entry_count FROM get_progress_history('your-challenge-id-here'::uuid, 'your-user-id-here'::uuid);

-- Check if progress_entries table exists and has data
SELECT 'Checking progress_entries table...' as check_name;
SELECT
    COUNT(*) as total_entries,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT challenge_id) as unique_challenges
FROM progress_entries;

-- Check if profiles table exists
SELECT 'Checking profiles table...' as check_name;
SELECT COUNT(*) as profile_count FROM profiles;
