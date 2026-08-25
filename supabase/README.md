# Supabase — schema, migrations, environments

## Layout

```
supabase/
  migrations/000_baseline.sql          production schema as of 2026-08-04
  seed.sql                             reference data (no user data)
  pending/077_enable_pro_gates.sql     held back deliberately — see below
  _archive/migrations_pre_baseline/    migrations 001–076, historical only
```

## Recreating an environment

```bash
supabase start            # boots local Postgres + services
supabase db reset         # applies migrations/, then seed.sql
```

That is the whole process. It produces a database matching production's
structure: 82 tables, 225 RLS policies, 32 triggers, 3 views, RLS enabled on
every table, plus the reference rows from `seed.sql`.

Two things a fresh environment deliberately does **not** get:

- **Users.** Create them through the gotrue admin API, as the test and spike
  flows do. Never copy `auth.*` from production — it holds password hashes,
  live refresh tokens and session IPs.
- **The `foods` table** (~1.9M rows). It is a bulk import, not seed material.
  Load it separately when you need nutrition search to work.

## Adding a migration

```bash
supabase migration new short_description   # creates a timestamped file
# edit it, then:
supabase db reset                          # verify from scratch locally
supabase db push                           # apply to the linked project
```

**Always `db push`.** Applying SQL by hand in the Supabase dashboard is what
broke this project once already (see below); if you ever must, immediately run
`supabase migration repair --status applied <version> --linked` so the history
table stays truthful.

## Why there is a baseline

Migrations 001–076 were applied to production over about a year, a good number
of them pasted into the dashboard SQL editor rather than pushed. Two problems
compounded:

1. The remote `supabase_migrations.schema_migrations` table recorded only
   001–005, so `db push` would have tried to replay ~72 already-applied
   migrations — including destructive ones (006 drops stored procedures and
   policies; 066/069 rewrite RLS).
2. Production had drifted from the migration set outright. Some migrations were
   never applied (016 privacy/consent tables, 034 journeys, 037 circle
   challenges, 067, 068, 073/074 exercise catalogue); others were superseded by
   renames (`circle_members` → `fitcircle_members`).

Repairing 001–076 as "applied" would have permanently buried those gaps behind
a history table claiming the work was done. So the schema was squashed instead:
`000_baseline.sql` is a `pg_dump` of production as it actually is, which makes
the migration set and the database agree again.

The originals are kept in `_archive/migrations_pre_baseline/` for reading. **Do
not re-apply them.**

### Gaps found during the squash — all closed

Capturing production faithfully also exposed what was missing from it. Each of
these had backend code querying an object the database did not have; all were
restored in migrations 078–080 (applied to production 2026-08-04) and by a code fix, on 2026-08-04:

| Was missing | Restored by |
|---|---|
| `privacy_settings`, `user_consent` — the GDPR/CCPA consent trail | `078_restore_consent_management.sql` (originally 016) |
| `exercises`, `exercise_sets`, `workout_exercises` + the 182-row catalogue | `079_restore_exercise_logging.sql` (originally 073/074) |
| `nutrition_training_samples` | `080_restore_nutrition_training_samples.sql` (originally 067) |
| `circle_members` — dropped in 018, superseded by `fitcircle_members` | code fix across 13 call sites |

The `circle_members` fix was not a rename: the old table used `circle_id` and a
boolean `is_active`, the new one uses `fitcircle_id` and a `status` text column.
One of those call sites was in the account-deletion cascade, where `safeDelete`
swallows a missing table with a warning — so erasure had been silently leaving
membership rows behind for every deleted account.

`081_streak_shield_consolidation.sql` (the shield-inventory data migration,
written as 078 on 2026-08-03) was never applied before the squash and was
renumbered to 081 because 078 was taken; it is the next migration to push.
Migration versions must be unique — `schema_migrations.version` is the key.

Still deliberately not restored, because nothing references them: 034
(journeys), 037 (circle challenges), 012 (`progress_milestones`), and 068
(`foods.name_embedding` + the `vector` extension).

## `pending/077_enable_pro_gates.sql`

077 flips the eight Pro feature gates from `free` to `premium` — the moment
free-tier limits begin for existing users. It is kept **out of `migrations/`**
on purpose: otherwise the next person pushing an unrelated migration would
silently launch paid gating.

Launch order, from 076's own header:

1. Enable the `subscriptions` flag (people can buy Pro; nothing is taken away).
2. Move 077 into `migrations/` and `db push` (free-tier limits begin).
