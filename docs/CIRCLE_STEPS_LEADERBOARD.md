# Circle steps leaderboard

Status: built 2026-11-01 on `feat/circle-steps-leaderboard` (BE, iOS, Android). No migration.

## Why

A circle's old leaderboard (`GET /api/mobile/circles/{id}/leaderboard`) ranks by the
member's circle *goal* (weight). A steps circle — e.g. one created with the
"8,000 Steps Daily" template — showed "No goal set" / 0% for everyone. This board
ranks by the steps HealthKit / Health Connect already sync into `daily_tracking`,
for **every active circle member** (challenge enrollment is not required).

Shipped clients that only know the goal board (iOS ≤ 1.1.0, Android ≤ 1.1.1 vc42) get
steps on it too: see "Shipped clients (goal board overlay)" below.

## Endpoint

```
GET /api/mobile/circles/{id}/steps-leaderboard        (Bearer auth, mobile envelope)
GET /api/fitcircles/{id}/steps-leaderboard            (web cookie session, body = data)
Header: X-Client-Timezone: America/New_York           (optional; decides the viewer's "today")
```

Errors: 400 `INVALID_CIRCLE_ID`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (not an active
member and not the creator), 404 `CIRCLE_NOT_FOUND`. `Cache-Control: private, no-store`.

## Response (`data`)

```jsonc
{
  "circle_id": "7d3f3a7d-…",
  "is_steps_circle": true,          // type step_count OR a non-cancelled challenge with unit "steps"
  "phase": "active",                // "upcoming" | "active" | "completed"
  "today": "2026-11-03",            // viewer's local date
  "start_date": "2026-11-02",       // first circle day
  "end_date": "2026-11-29",         // LAST counted day (inclusive) = fitcircles.end_date - 1
  "total_days": 28,
  "day_number": 2,                  // 1-based, null unless active
  "days_until_start": 0,            // > 0 only when upcoming (1 = starts tomorrow)
  "daily_goal": { "steps": 8000, "source": "challenge" },   // null => per-member goals
  "challenge": { "id": "2e75…", "name": "8,000 Steps Daily", "participant_count": 3 },  // or null
  "default_metric": "today_steps",
  "member_count": 7,
  "members": [                      // sorted by ranks.today_steps (nulls last, then name)
    {
      "user_id": "d152…",
      "display_name": "Ani",
      "avatar_url": null,
      "is_me": true,
      "steps_visible": true,          // false => the member hides progress; all step fields null
      "today_steps": 9214,            // null when upcoming or hidden
      "total_steps": 17020,           // sum over start_date..member's today (capped at end_date)
      "daily_goal_steps": 8000,
      "goal_source": "challenge",     // "challenge" | "member" (their saved step goal) | "default" (10,000)
      "goal_pct_today": 115,          // rounded, UNCAPPED; null when upcoming or hidden
      "days_goal_met": 1,
      "steps_synced_recently": true,  // any steps synced in the 7 days before today; null if hidden
      "last_synced_at": "2026-11-03T14:02:11Z",
      "ranks": { "today_steps": 1, "total_steps": 2, "goal_pct_today": 1 },  // competition ranking (1,1,3); null = unranked
      "days": [                       // start_date..member's today, ascending; [] when upcoming/hidden
        { "date": "2026-11-02", "steps": 7806 },
        { "date": "2026-11-03", "steps": 9214 }   // steps null = nothing synced that day
      ]
    }
  ]
}
```

### Rules

- **Metrics**: `today_steps`, `total_steps`, `goal_pct_today`. Clients sort by
  `ranks[metric]` (nulls last, then `display_name`) and show the rank number from
  `ranks[metric]`. No client-side math beyond formatting.
- **Local day**: each member's "today" is their own profile timezone
  (`profiles.timezone`, kept in sync from X-Client-Timezone; the `UTC` default
  falls back to the viewer's zone). `daily_tracking.tracking_date` is already the
  device's local date.
- **Daily goal**: a daily step-challenge template `steps-<N>k-daily` sets N×1000 for
  everyone; otherwise the member's saved step goal (`profiles.goals[type=steps]`),
  else 10,000.
- **Privacy**: a member whose `preferences.privacy.show_progress` is false (legacy
  top-level `show_progress` honoured too) is listed with `steps_visible: false`,
  null values and null ranks. The viewer always sees themselves.
- **Pre-start** (`phase: "upcoming"`): every metric/rank is null and `days` is
  empty; clients show "Starts tomorrow" / "Starts in N days", the member list, and
  a per-member "steps syncing" marker from `steps_synced_recently`.
- **Completed**: "today" is the last circle day.

## Shipped clients (goal board overlay)

`GET /api/mobile/circles/{id}/leaderboard` and the `leaderboard` inside
`GET /api/mobile/circles/{id}` keep their shape. For a steps circle
(`is_steps_circle`) the server fills the goal fields from this board
(`overlayLegacySteps`) with the **running total since the circle started**:
the same ranking as the new board's **Total** tab. Today's steps alone are never shown.

Shipped rows render (iOS 1.1.0 `CircleDetailFeature.LeaderboardRow`, Android
`LeaderboardRowText.goalDescription`): `"%.1f <goal_unit> → %.1f <goal_unit> goal"`
when `current_value > 0`, else `"No data → %.1f <goal_unit> goal"`; then
`"<progress_percentage>%"` with a bar capped at 100. The "x of y" line only shows
when `starting_value` is set.

| field | value |
|---|---|
| `current_value` | total steps since the start, thousands, one decimal (`21.9`) |
| `target_value` | daily goal × goal-days elapsed, thousands (`11.8`) |
| `goal_unit` | `"k steps"` → "21.9 k steps → 11.8 k steps goal" |
| `progress_percentage` | round(total ÷ target × 100), uncapped |
| `starting_value` | null |
| `rank` | 1..n by total steps (ties: today's steps) |

**Goal-days elapsed** (`goalDaysElapsed`) = completed circle days + the share of
today that has passed on the member's clock (profile timezone), at least 1;
every day once the circle is over. The expected total grows at the goal's pace
through the day, so there is no drop at midnight (whole-day counting would knock
everyone down by a day's goal each morning), and members in one timezone share
the denominator, so % order is the same as the total order. The new board has no
"% of total" figure to match (its % Goal tab is today-only), so this is the
consistent choice with its Total tab.

Example (prod, Nov steps challenge, 2026-11-03 11:23 Toronto, day 2): goal-days
1 + 683/1440 = 1.474, target 8,000 × 1.474 = 11,794. Raveesh "21.9 k steps →
11.8 k steps goal", 185%, #1; Ani "16.4 k steps → 11.8 k steps goal", 139%, #2.

History: 2026-11-01 shipped an average per day (`k steps/day`), which was
dominated by earlier days and looked frozen on iOS 1.1.0 next to the live board.

## Circle days

`fitcircles.start_date` is midnight UTC of the first day. `end_date` is either
midnight UTC of the day after the last day (exclusive, current circles) or 23:59
UTC on the last day (older circles); `exclusiveEndDay` handles both. A circle
stored 2026-11-02 → 2026-11-30 00:00 runs Nov 2–29: day 2 of 28 on Nov 3. Clients
must read these as calendar dates (their UTC date), not as instants in the
device zone: Nov 2 00:00 UTC is Nov 1 19:00 in Toronto.
