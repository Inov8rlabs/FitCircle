# Production Runbook — Switch Nutrition Intelligence On

This runbook turns on the Nutrition Intelligence feature (PRD v4 §6) in **production**.

**State as of 2026-06-05:** the web/backend build is unblocked and prod deploys are green again
(the `mapReactionError` route-export bug that froze every prod deploy since early June is fixed).
But the feature does **not function** in prod until the DB schema and the AI Gateway key exist there.

These steps require prod credentials, so a human runs them — they are not automatable from a dev
checkout. Order matters.

---

## Step 1 — Apply the nutrition migrations to the prod Supabase

The 12 nutrition-era migrations in `supabase/migrations/` (pending on prod):

```
054_food_log_nutrition_columns      058_food_feed_reactions          062_group_meal
055_foods_reference_table           059_circle_streak                063_dietary_prefs
056_plate_score                     060_nutrition_challenge_metrics  064_drop_dead_stored_procedures
057_food_privacy_tiers              061_health_nutrition_sync        065_foods_image_url
```

The Supabase CLI is not linked to prod in a fresh checkout, so:

```bash
cd FitCircleBE
supabase link --project-ref <PROD_PROJECT_REF>   # from the Supabase dashboard URL; prompts for DB password
supabase migration list                          # REVIEW: confirm only 054–065 are local-only / pending
supabase db push                                 # applies pending migrations in filename order
```

- `supabase db push` tracks applied migrations and only runs the missing ones, in order.
- **`064` drops 10 stored procedures** audited as dead (0 callers across BE/iOS/Android). It runs against
  prod, so review `supabase migration list` first to confirm you are applying only the intended set
  (watch for unexpected earlier-migration drift).
- **Take a Supabase PITR snapshot before this step** (rollback insurance — migrations are not auto-reverted).

## Step 2 — Set env vars in Vercel (Production scope), then redeploy

Vercel → project `fit-circle-web` → Settings → Environment Variables (Production):

- **`AI_GATEWAY_API_KEY`** — a **freshly rotated** Vercel AI Gateway key. Without it, photo/voice parsing
  fails (and, thanks to the "Option B" fallback, saves a blank food-log entry instead of crashing).
- **`SUPABASE_SERVICE_ROLE_KEY`**, **`NEXT_PUBLIC_SUPABASE_URL`** — confirm they point at prod (likely already set).
- **`CRON_SECRET`** — likely already set (pre-existing streak crons use it); the weekly `foods-loader`
  cron also needs it.

Env changes take effect only on a new deploy → **redeploy** (Deployments → Redeploy latest, or push a commit).

## Step 3 — Populate the prod `foods` table

Migrations create an **empty** `foods` table. Photo-parse still works (DB matching is Stage-4 enrichment),
but **food search + barcode return nothing** until it is loaded. Run the bulk loader against prod:

```bash
cd FitCircleBE
DATABASE_URL="<PROD_POSTGRES_URL>" NODE_OPTIONS="--max-old-space-size=8192" \
  node scripts/load-foods-bulk.mjs usda data/FoodData_Central_csv_2026-04-30/
```

- Idempotent (upserts on `(source, source_id)`), ~1.9M USDA rows. See `scripts/golden/NUTRITION5K.md`
  and the loader header for OFF + USDA download instructions.
- The weekly `foods-loader` cron (`vercel.json`, Sun 04:00 UTC) then keeps OFF data fresh.

## Step 4 — Verify

1. Redeploy shows `READY` in Vercel.
2. Schema present: `foods` table exists; `food_log_entries` has `calories / protein_g / carbs_g / fat_g /
   input_method / nutrition_source / food_id` columns.
3. Smoke test (a client, or curl with a real bearer token):
   - `POST /api/mobile/food/photo-parse` (multipart `image`) → returns a draft.
   - `GET /api/mobile/foods/search?q=chicken` → returns rows (after Step 3).
4. **Eval gate (recommended before trusting macros)** — run the eval against the Nutrition5k golden set:
   ```bash
   AI_GATEWAY_API_KEY=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
     npx tsx scripts/run-nutrition-eval.mjs scripts/golden/nutrition5k.json
   ```
   The §8.3 thresholds are aspirational; the real accuracy gate is a human-weighed South-Asian/Canadian
   plated-meal golden set (still to be collected).

## Rollback

- **App:** Promote the last-good deploy (`d2230055`) in Vercel.
- **DB:** migrations are not auto-reverted — restore from the PITR snapshot taken in Step 1.

---

## Appendix — what shipped (2026-06-05)

| Repo | Merged |
| --- | --- |
| FitCircleBE | #17 macro clamp · #18 prod-build fix · #19 Option B (backend + web) · #20 Nutrition5k eval adapter |
| FitCircle-iOS | #3 Option B |
| Fitcircle-Android | #34 Option B (+ restored a broken `main` build) |

- **Option B** ("never lose a failed parse"): on `PARSE_FAILED` (422) / `RATE_LIMITED` (429), the server
  saves the user's photo/voice input as a normal food-log entry (blank macros) and returns
  `error.details.savedEntryId`; clients route the user to that entry's edit screen. Success path is
  unchanged (confirm-then-commit).
- **Nutrition5k** golden-set adapter gives the eval real weighed ground truth; images stream over HTTPS.
