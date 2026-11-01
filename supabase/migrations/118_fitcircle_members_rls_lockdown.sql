-- 118: Lock down direct (PostgREST) writes to fitcircle_members.
--
-- The old policies let any signed-in user insert a membership row for
-- themselves into ANY circle (with_check auth.uid() = user_id), bypassing invite
-- codes, private visibility, capacity and late-join rules, and update their own
-- row freely (role -> 'admin', status, invited_by, ...).
--
-- Every join now goes through the server (service role):
--   POST /api/mobile/circles/join, POST /api/mobile/circles/{id}/join.
-- The only remaining browser write is the web circle wizard adding the creator
-- to the circle they just created, so INSERT is limited to that case.
-- No browser or app code updates member rows directly, so UPDATE is removed.
-- Policies only; no functions or triggers.

DROP POLICY IF EXISTS fitcircle_members_insert ON public.fitcircle_members;
CREATE POLICY fitcircle_members_insert ON public.fitcircle_members
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.fitcircles f
      WHERE f.id = fitcircle_id AND f.creator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS fitcircle_members_update ON public.fitcircle_members;
