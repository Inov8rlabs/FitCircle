# Nutrition / Fitzy — Known Gaps & Follow-ups

Captured 2026-06-07 from the iOS Fitzy + AI-food-flow work. These are deliberate follow-ups, not
blockers for what shipped (Fitzy backend FitCircleBE #22; iOS PRs #4 Fitzy coach, #5 "+" AI flow).

---

## 1. Structured macros aren't persisted → Plate Score (and Fitzy/insights) come up empty  — HIGH

**Symptom:** the Nutrition tab shows *"Plate Score — Couldn't load your score right now."*

**Root cause:** `food_log_entries` HAS typed macro columns (`calories`, `protein_g`, `carbs_g`,
`fat_g`, plus `food_id`, `servings`, `input_method`, `nutrition_source`, `llm_confidence` — added
in migration `054`), but the entry **create paths don't populate them**:

- **iOS** `FoodLogEntry` model exposes only a `notes` field (no macro columns). The "+" add-meal
  flow — and the existing `NutritionConfirmFeature` — therefore fold the AI macros into `notes` as
  human-readable text, not as numbers. (The model predates the nutrition macro columns.)
- **Backend** `FoodLogService.createEntry` inserts `nutrition_data` (JSONB) + title/notes/meal_type,
  but **not** the typed `calories/protein_g/...` columns. (Verify the same for the entry PATCH path.)

**Downstream impact:** everything computed server-side from the typed columns is starved of data —
**Plate Score**, Fitzy's "your recent macros" grounding (`FitzyService.buildContext`), nutrition
insights, and the nutrition leaderboard. This is almost certainly why Plate Score won't load.

**Fix plan (separate effort, all 3 clients + backend):**
1. **Backend:** extend `CreateFoodLogEntryInput` + `FoodLogService.createEntry` (and the entry
   update path) to accept and write `calories/protein_g/carbs_g/fat_g/servings/food_id/
   input_method/nutrition_source`. Keep `notes` for the human-readable summary.
2. **iOS:** add those fields to the food-log entry model + create/confirm paths; have the "+" AI
   flow and `NutritionConfirm` send structured macros (not just notes text).
3. **Android / web:** same — send structured macros on create.
4. **Verify:** after a meal with macros is logged, Plate Score returns a score and Fitzy's context
   reflects the real macro averages.

---

## 2. Fitzy + AI add-meal flow not yet on Android / web  — MEDIUM

Shipped on iOS only (per the user's "iOS first" choice). To port:
- **Fitzy:** global floating button on every screen → slide-up chat calling `POST
  /api/mobile/fitzy/chat`; **render replies as Markdown** (web: a markdown renderer; Android:
  a Markwon/Compose markdown approach); **persist history** locally; rebrand "Nutrition coach" →
  **Fitzy**; re-point existing coach entry points.
- **Add-meal flow:** merge AI photo/voice analysis into the primary log-a-meal flow with camera OR
  gallery as the photo source, pre-filling the entry for the user to confirm/edit.

---

## 3. `AI_GATEWAY_API_KEY` must be set per environment  — REMINDER

Fitzy chat and photo/voice parse call the live Vercel AI Gateway. Without `AI_GATEWAY_API_KEY` in
the target environment they degrade to the safe-fallback reply / a saved-but-unanalyzed entry. See
`docs/NUTRITION_PROD_RUNBOOK.md` for the prod steps (migrations + env var + foods bulk-load).
