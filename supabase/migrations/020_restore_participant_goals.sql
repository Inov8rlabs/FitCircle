-- Migration 020: Restore participant goals from the web interface data
-- This migration updates the participants with their goals that were visible in the web UI

-- Circle ID: OakvilleBesties (88311404-7602-47c4-98ac-85b0d895296d)

-- 1. Ani (You) - 94.1 kg → 84.0 kg goal (Weight Loss)
--    Progress: 9% (1.0 kg of 11.1 kg lost)
--    Current: 94.1 - 1.0 = 93.1 kg
UPDATE challenge_participants
SET
  goal_type = 'weight_loss',
  goal_start_value = 94.1,
  goal_target_value = 84.0,
  goal_unit = 'kg',
  current_value = 93.1,
  progress_percentage = 9.0,
  updated_at = NOW()
WHERE challenge_id = '88311404-7602-47c4-98ac-85b0d895296d'
  AND user_id IN (
    SELECT id FROM profiles WHERE display_name = 'Ani'
  );

-- 2. Raveesh - 104 kg → 95.0 kg goal (Weight Loss)
--    Starting value: 104 kg (from current_value in db)
--    Progress: 0% (no weight lost yet)
UPDATE challenge_participants
SET
  goal_type = 'weight_loss',
  goal_start_value = 104.0,
  goal_target_value = 95.0,
  goal_unit = 'kg',
  current_value = 104.0,
  progress_percentage = 0,
  updated_at = NOW()
WHERE challenge_id = '88311404-7602-47c4-98ac-85b0d895296d'
  AND user_id IN (
    SELECT id FROM profiles WHERE display_name = 'Raveesh'
  );

-- 3. SalK - 82 kg → 72.0 kg goal (Weight Loss)
--    Starting value: 82 kg (from current_value in db)
--    Progress: 0% (no weight lost yet)
UPDATE challenge_participants
SET
  goal_type = 'weight_loss',
  goal_start_value = 82.0,
  goal_target_value = 72.0,
  goal_unit = 'kg',
  current_value = 82.0,
  progress_percentage = 0,
  updated_at = NOW()
WHERE challenge_id = '88311404-7602-47c4-98ac-85b0d895296d'
  AND user_id IN (
    SELECT id FROM profiles WHERE display_name = 'SalK'
  );

-- 4. Aditya - 78 kg → 75.0 kg goal (Weight Loss)
--    Starting value: 78 kg (from current_value in db)
--    Progress: 0% (no weight lost yet)
UPDATE challenge_participants
SET
  goal_type = 'weight_loss',
  goal_start_value = 78.0,
  goal_target_value = 75.0,
  goal_unit = 'kg',
  current_value = 78.0,
  progress_percentage = 0,
  updated_at = NOW()
WHERE challenge_id = '88311404-7602-47c4-98ac-85b0d895296d'
  AND user_id IN (
    SELECT id FROM profiles WHERE display_name = 'Aditya'
  );

-- Verify the updates
SELECT
  p.display_name,
  cp.goal_type,
  cp.goal_start_value,
  cp.current_value,
  cp.goal_target_value,
  cp.goal_unit,
  cp.progress_percentage
FROM challenge_participants cp
JOIN profiles p ON cp.user_id = p.id
WHERE cp.challenge_id = '88311404-7602-47c4-98ac-85b0d895296d'
ORDER BY cp.joined_at;
