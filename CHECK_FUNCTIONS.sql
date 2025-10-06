-- Check if the progress functions exist and are working
-- Run this in Supabase SQL Editor

-- 1. Check if functions exist
SELECT
    proname as function_name,
    pg_get_function_identity_arguments(oid) as arguments,
    obj_description(oid, 'pg_proc') as description
FROM pg_proc
WHERE proname IN ('get_user_circles_with_progress', 'get_participant_progress', 'get_progress_history');

-- 2. Check if progress_entries table exists
SELECT
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE tablename = 'progress_entries';

-- 3. Check if profiles table exists
SELECT
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE tablename = 'profiles';

-- 4. Test the functions (replace with your actual IDs)
-- SELECT 'Testing get_user_circles_with_progress...' as test_name;
-- SELECT COUNT(*) as circle_count FROM get_user_circles_with_progress();

-- Test with a specific challenge ID (you'll need to get a real challenge_id from your challenges table)
-- SELECT 'Testing get_participant_progress...' as test_name;
-- SELECT COUNT(*) as participant_count FROM get_participant_progress('your-challenge-id-here'::uuid);

-- 5. Check current user context
SELECT auth.uid() as current_user_id;

-- 6. Check if there are any challenges
SELECT COUNT(*) as total_challenges FROM challenges;

-- 7. Check if there are any participants
SELECT COUNT(*) as total_participants FROM challenge_participants WHERE status = 'active';

-- 8. Check if there are any progress entries
SELECT COUNT(*) as total_entries FROM progress_entries;
