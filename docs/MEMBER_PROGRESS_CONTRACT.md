# Circle member progress (profile sheet) — contract

Fixes the member "Profile" sheet opened from a circle (iOS `UserDetailView`,
Android `UserProfileScreen`, web circle participant modal). Before this, a steps
circle rendered the member's daily step totals as weigh-ins (10,109 steps became
"22,286.5 lbs"), with a weight card, "lost" deltas and "Today at 12:00 AM".

## Root cause

- `GET /api/mobile/circles/{id}/users/{userId}/history` mapped the circle type to a
  `daily_tracking` column (`step_count → steps`, anything unknown → `weight_kg`) but
  always returned the value in `entries[].weight`. Every client treats `weight` as kg.
- `circle_check_ins` is empty in prod, so every circle used that fallback.
- `workout_minutes` and `custom` circles fell through to `weight_kg`, so they showed
  the member's weigh-ins regardless of what the circle tracks.
- The weight history ignored `show_weight` (only `show_progress` was checked) and the
  per-row `daily_tracking.is_public` flag.
- The 0-step rows: iOS builds before c13898f (`HealthKitManager.fetchStepsForDateRange`)
  enumerate statistics through `endOfEndDate` (exclusive end passed as inclusive), so each
  sync sends one extra 0-step day labelled TOMORROW to `/tracking/bulk-sync`
  (prod: rows for tomorrow with `steps = 0`, `steps_source = healthkit`, created the day
  before). Current iOS main filters `steps > 0` and keys days from its own window.

## New endpoint (what new clients use)

`GET /api/mobile/circles/{circleId}/users/{userId}/circle-progress`

Standard envelope (`success`, `data`, `error`, `meta`). `data`:

```jsonc
{
  "user_id": "uuid",
  "circle_id": "uuid",
  "circle_type": "step_count" | "weight_loss" | "workout_minutes" | "custom",
  "metric": "steps" | "weight" | "workout_minutes" | "custom" | "none",
  "unit": "steps" | "kg" | "min" | "<challenge unit, e.g. reps>" | null,
  "label": "Steps" | "Weight" | "Workout minutes" | "<challenge name>" | null,
  "aggregation": "daily_total" | "measurement",   // weight = measurement, else daily_total
  "can_view": true,
  "hidden_reason": null | "weight_private" | "progress_private" | "profile_private" | "not_in_circle",
  "timezone": "America/Toronto",    // member's profile timezone
  "today": "2026-11-05",            // member's local today
  "period": { "start": "2026-11-02", "end": "2026-11-30" } | null,
  "summary": {
    "total": 28797,                 // daily_total metrics: sum over the period; null for weight
    "daily_average": 7199,          // over days_logged; null for weight
    "days_logged": 4,
    "best_day": { "date": "2026-11-02", "value": 10109 } | null,
    "today_value": 3007 | null,     // member-local today, null if nothing logged today
    "goal": 224000 | null,          // circle challenge goal_amount (same unit), if any
    "progress_percentage": 12.9 | null,
    // weight only (kg; null otherwise):
    "starting": 94.0 | null,
    "current": 89.0 | null,
    "target": 84.0 | null,
    "change": -5.0 | null           // current - starting: negative = lost, positive = gained
  },
  "entries": [                      // newest first
    {
      "id": "uuid",
      "date": "2026-11-05",         // DATE ONLY, the member's local day. Render as a date
                                    // ("Today", "Yesterday", "Nov 4"), never with a time.
      "value": 3007,                // in `unit`; weight in kg
      "change": -6123 | null,       // value - the chronologically previous (older) entry
      "is_public": true,
      "note": null
    }
  ]
}
```

Rules the server guarantees:

- Entries only carry real values: `value > 0`. No placeholder/zero rows, no dates after
  the member's local today, only dates inside the circle period (when the circle has one).
- `change` is always `value - older value`. For weight: negative = lost (good), positive =
  gained. For daily totals clients usually don't show `change`.
- Weight values are kilograms. Clients convert ONLY weight (`metric == "weight"`) with the
  VIEWER's unit preference (lbs/kg). Steps / minutes / custom units are never converted.
- Privacy for a viewer who is not the member:
  - `profile_visibility == "private"` → `can_view=false`, `hidden_reason="profile_private"`.
  - weight metric and `show_weight == false` → `weight_private`.
  - `show_progress == false` → `progress_private` (any metric).
  - viewer not an active member of the circle → `not_in_circle`.
  - `daily_tracking.is_public == false` / `exercise_logs.is_public == false` rows are left out.
  - When hidden: `entries = []`, every `summary` value null / 0 `days_logged`.
- Metric resolution: `step_count → steps` (daily_tracking.steps); `weight_loss → weight`
  (daily_tracking.weight_kg); `workout_minutes → workout_minutes` (exercise_logs
  duration_minutes summed per exercise_date, not deleted); `custom → ` the circle's active
  challenge: unit `steps` → steps, a weight unit → weight, otherwise `custom` with
  challenge_logs amounts summed per log_date (unit = challenge unit, label = challenge name);
  no challenge → `none` (no entries; show "No shared progress for this circle yet").

## Legacy endpoints (shipped iOS 1.1.0/1.1.1, Android 1.1.1) — server-side fix

All additive; shapes unchanged:

- `/history`: `entries[].weight` is ONLY ever a weight in kg. Non-weight circles return
  `entries: []`. Weight entries respect `show_weight` (hidden → `can_view: false`),
  `is_public`, and drop zero/future rows. Adds `metric` and `unit`.
- `/progress`: non-weight circles return `success: true, data: null` (both shipped apps
  then render no weight card). Weight circles unchanged plus `metric: "weight"`, `unit: "kg"`.
- `/profile`: `current_weight` / `starting_weight` / `target_weight` only for weight circles;
  `progress_percentage` follows the circle's metric.
- `/tracking/bulk-sync`: a `steps: 0` entry dated after the member's local today is skipped
  (`reason: "future_zero"`), so old iOS builds stop creating 0-step "tomorrow" rows.
