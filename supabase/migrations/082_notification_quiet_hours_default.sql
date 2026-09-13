-- 082: default quiet hours for push notifications (PRD: 10pm–7am local).
--
-- Null quiet_hours_start/end now means "the user turned quiet hours off"
-- (the iOS, Android and web settings screens send explicit nulls for that).
-- Rows created before those screens existed never expressed a choice, so
-- they get the default window. New rows get it from the column defaults.

ALTER TABLE public.notification_preferences
  ALTER COLUMN quiet_hours_start SET DEFAULT '22:00',
  ALTER COLUMN quiet_hours_end SET DEFAULT '07:00';

UPDATE public.notification_preferences
SET quiet_hours_start = '22:00',
    quiet_hours_end = '07:00',
    updated_at = NOW()
WHERE quiet_hours_start IS NULL
  AND quiet_hours_end IS NULL;
