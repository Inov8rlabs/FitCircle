# Dashboard Vitals — client contract & design

Status: implemented on the backend 2026-08-26 (`VitalsService`, `GET /api/mobile/vitals/summary`,
`PUT /api/mobile/vitals/goals`). This is the spec every client renders against. Clients are thin
renderers: the server does all day/timezone math, goal math and BMI math. Clients only convert
canonical units (kg, ml) to the user's display units.

## Endpoints

### `GET /api/mobile/vitals/summary?days=7`
Bearer auth. Reads `x-client-timezone` (all clients send it) → profile timezone → UTC.
`days` 1–90, default 7. `Cache-Control: private, max-age=60`.

```jsonc
{
  "success": true,
  "data": {
    "period": { "days": 7, "start": "2026-08-19", "end": "2026-08-25", "timezone": "America/Toronto" },
    "units": "metric",                          // "metric" | "imperial" — user's display preference
    "weight": {                                 // null when the user has never logged a weight
      "current_kg": 78.5, "current_date": "2026-08-25",
      "baseline_kg": 80.1, "baseline_date": "2026-08-19",   // what change_kg is measured against
      "change_kg": -1.6,                        // current − baseline; negative = lost; null if nothing to compare
      "series": [ { "date": "2026-08-19", "kg": 80.1 }, /* … only days WITH a reading, oldest first */ ],
      "goal": {                                 // null when no weight goal is set
        "target_kg": 73.0, "starting_kg": 85.0, // starting = user-set, else earliest reading on file
        "to_go_kg": 5.5, "direction": "lose",   // "lose" | "gain" | "maintain"
        "progress_pct": 54, "reached": false    // progress starting→target, 0–100, null if unknown
      }
    },
    "bmi": {
      "value": 24.2, "category": "normal",      // "underweight" | "normal" | "overweight" | "obese"
      "height_cm": 180,
      "healthy_range_kg": { "min": 59.9, "max": 80.7 },
      "scale": { "min": 14, "max": 40, "bands": [
        { "key": "underweight", "label": "Underweight", "from": 14,   "to": 18.5 },
        { "key": "normal",      "label": "Normal",      "from": 18.5, "to": 25 },
        { "key": "overweight",  "label": "Overweight",  "from": 25,   "to": 30 },
        { "key": "obese",       "label": "Obese",       "from": 30,   "to": 40 } ] },
      "missing": null                           // "height" | "weight" when value is null
    },
    "water": {
      "goal_ml": 2000, "goal_source": "default", // "user" | "default"
      "days": [ { "date": "2026-08-19", "ml": 1800, "goal_met": false }, /* … exactly `days` entries, oldest first */ ],
      "total_ml": 17400, "total_goal_ml": 14000, "pct": 124, "days_met": 6, "today_ml": 1250
    }
  },
  "error": null, "meta": { "timestamp": "…" }
}
```

### `PUT /api/mobile/vitals/goals`
Body (any subset; `null` clears): `{ "target_weight_kg": 73.0, "starting_weight_kg": 85.0, "daily_water_ml_target": 2500 }`.
Ranges: weight 20–400 kg, water 250–10000 ml. Returns the refreshed 7-day summary in `data`.
Weight goal is stored in `profiles.goals[type=weight]` (shape all clients already decode); the
hydration target in `profiles.preferences.hydration.daily_water_ml_target` — **not** a new `goals[]`
type, because shipped iOS builds decode `goals[].type` as a closed enum.

## Cards (all platforms, same structure)

Placement: directly below the existing hero grid (steps ring | weight card), above Body Composition.

### 1. Weight card (upgrade the existing hero weight card — don't add a second one)
- Header row: scale icon (purple) · **Weight · 7 days**
- Line 1: `78.5 kg` (big) · `BMI 24.2` (secondary, only when bmi.value) · change chip `↓ 1.6 kg` / `↑ 0.4 kg`
  - chip colour: toward the goal = green, away = orange, no goal = neutral secondary. For `direction:lose` a negative change is "toward".
- Line 2: `Goal: 73.0 kg · 5.5 kg to go` (to-go in orange); reached → `Goal reached 🎉` (green);
  no goal → `Set a goal` as a tappable link (opens the goal sheet — see below).
- Keep the existing lbs/kg toggle where the platform already has one (iOS). Display units = `units`.
- The existing weight chart stays where it is (charts section).

### 2. BMI card (new, full width)
- Header: `BMI` + subtitle `Body Mass Index`; right: big `24.2` + category chip (`Normal`).
- Scale bar: four contiguous segments proportional to `scale.bands` widths, colours below; a 3px marker
  at `bmiScalePosition(value)`; tick labels `14 · 18.5 · 25 · 30 · 40` under the segment boundaries.
- Legend row: four dots+labels using the band colours.
- Callout (soft green tint): ✓ **Healthy weight range** — `59.9 kg – 80.7 kg for your height (180 cm)`.
- `missing: "height"` → replace value/scale with `Add your height to see BMI` + button to Edit Profile.
- `missing: "weight"` → `Log a weight to see BMI`.
- Category colours (brand tokens, NOT the reference screenshot's palette):
  underweight = cyan, normal = green, overweight = orange, obese = error/red.

### 3. Water this week (new, full width)
- Header: drop icon (cyan) · **Water this week**; right: `124%` (green when ≥100, cyan otherwise).
- Subtitle: `17.4 L / 14.0 L · Goal reached!` or `9.2 L / 14.0 L · 3 of 7 days met`.
- Bars: one per `days[]` entry (cyan; green when `goal_met`), dashed goal line at `goal_ml`,
  weekday initials under each bar, today emphasised. Y labels in L (metric) or fl oz/cups (imperial: show `oz`).
- Goal editable: small pencil/`Edit` affordance → goal sheet.

### Goal sheet (new on iOS & Android; web uses existing profile flow + inline edit)
Two fields: target weight (display units, converted to kg on save) and daily water (ml / oz).
Calls `PUT /api/mobile/vitals/goals`, replaces the summary with the response.

## Units
- `units == "imperial"`: kg × 2.20462 → lb (1 decimal), ml × 0.033814 → fl oz (0 decimals), L labels → oz.
- Never 0-base weight axes; never render days without a reading as 0 (series already omits them).

## Design tokens
| Concept | iOS | Android | Web |
|---|---|---|---|
| Weight | `AppTheme.Colors.purple` | `AppTheme.Colors.purple` | `purple-400/500` `#8b5cf6` |
| Water | `AppTheme.Colors.cyan` | `AppTheme.Colors.cyan` | `cyan-400/500` `#06b6d4` |
| Toward goal / met | `Colors.green` | `Colors.green` | `emerald-400` `#10b981` |
| Away / to-go | `Colors.orange` | `Colors.orange` | `orange-400` `#f97316` |
| Obese / error | `Colors.error` | `Colors.error` | `red-400` `#ef4444` |
| Card | `GlassCard` + `Spacing.md` | `GlassCard` + `padding(16.dp)` | `Card bg-slate-900/50 border-slate-800 backdrop-blur-xl` |
| Chip | `Capsule().fill(c.opacity(0.15))`, caption medium | `RoundedCornerShape(full)`, `c.copy(alpha=.15f)` | `rounded-full px-2 py-1 text-xs bg-c/15 text-c` |
| Big value | `.system(size: 42, weight: .bold)` | `displaySmall` bold | `text-3xl sm:text-4xl font-bold` |
