-- 085: allow the daily-streak milestone share card (rendered by /api/og/share-card).
alter table public.share_cards drop constraint if exists share_cards_card_type_check;
alter table public.share_cards add constraint share_cards_card_type_check
  check (card_type = any (array['milestone','streak_milestone','challenge_complete','perfect_week','momentum_flame','circle_boost']::text[]));
