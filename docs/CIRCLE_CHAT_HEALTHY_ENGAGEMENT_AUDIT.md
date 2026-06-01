# Circle Chat — Healthy-Engagement Copy Audit

**Gate:** PRD §6.7 / Build Spec §7 — Gate 3 (healthy-engagement bar)
**Scope:** Every piece of user-facing copy the Circle Chat feature emits.
**Mode:** READ-ONLY. No code was modified.
**Worktree:** `/Users/ani/Code/FitCircleBE-circlechat`
**Date:** 2026-06-01

---

## 1. Verdict

**PASS-WITH-NOTES.**

All system-post copy, chat-notification copy, and the daily-summary copy path are food-neutral, body-neutral, non-shaming, and never rank by restriction. No source emits a weight/body/alcohol broadcast — hard exclusions are enforced structurally (taxonomy allow-list + `HARD_EXCLUDED_SOURCES`) and eval-asserted. No violations were found.

The "notes" are about **coverage of the automated guardrail**, not about live violations:
1. The eval's forbidden-substring scan only inspects `renderCopy()` output. It does **not** cover the notification-orchestrator templates, does **not** assert the `daily_summary` count fields can never carry a calorie/weight number, and does **not** exercise the `@mention` preview path.
2. The `chat_message` / `chat_mention` push **preview echoes raw user-typed text** — by design uncoverable by templates. Assessed as acceptable (standard DM-preview behavior), documented below.
3. `notable_meal` is config-gated OFF but its template is correct and number-free when it turns on (eval-asserted).

None of these block the gate; all are hardening recommendations (§4).

---

## 2. Per-source findings

| Source | Copy reviewed | Verdict | Note |
|---|---|---|---|
| `system-post-engine.ts` `renderCopy()` (lines 126–172) | All 11 templates: workout_done, streak_milestone, circle_streak, quest_done, challenge_milestone, challenge_resolved, daily_summary, member_joined, new_challenge, notable_meal | PASS | Celebratory/supportive "update" voice. No good/bad food, no cheat/guilt, no ranking by restriction, no calorie/weight. The only numbers emitted are streak days, day counts, and check-in counts — none are body/food metrics. |
| `system-post-engine.ts` `renderChallengeMilestone()` (429–442) | "Halfway/One week left/Final day … here's how everyone's doing" | PASS | Frames the whole circle ("everyone's doing"), not a restriction leaderboard. |
| `circle-chat-engine.ts` `EVENT_TAXONOMY` (56–67) | Allow-list of postable event types | PASS | Closed allow-list; anything not a key never posts (engine line 53–58). `notable_meal` and `circle_streak` ship `enabledByDefault: false`. |
| `circle-chat-engine.ts` `HARD_EXCLUDED_SOURCES` (71) | `['weight','body_measurement','beverage','alcohol']` | PASS | Independent hard block (engine line 54, 56–58) regardless of taxonomy. Rule §4 enforced in code. |
| `circle-chat-engine.ts` `SignalPayload` (28–39) | Payload field contract | PASS | Comment-frozen: `mealDescriptor` "NEVER calories"; "no weight, body measurements, alcohol/beverage, or raw calorie fields ever." No calorie/weight field exists on the type. |
| `notification-orchestrator.ts` `chat_message` (270–274) | title `"{friend} in {circle}"`, body = `data.preview` | PASS-WITH-NOTES | Body is raw user text (see § Specific Risk). Template chrome is neutral. |
| `notification-orchestrator.ts` `chat_mention` (275–279) | title `"{friend} mentioned you"`, body = `data.preview` | PASS-WITH-NOTES | Same raw-preview consideration. |
| `notification-orchestrator.ts` `chat_rally` (280–284) | title `"🎉 Big moment in {circle}"`, body = `data.body` | PASS | `data.body` is the system-post body (engine `renderCopy` output — already neutral; passed from `ingest()` line 219–224 / `notifyRallyPost`). Fallback constant `"Something worth celebrating just happened!"` is neutral. |
| `notification-orchestrator.ts` — broader template set scan (120–267) | All journey/momentum/circle/challenge/summary templates | PASS (with adjacent note) | None broadcast food/weight/restriction. `circle_boost_threshold` (211) and `perfect_day` (214–218) broadcast check-in counts only. `challenge_halfway`/`challenge_completed` (226–240) surface `#rank` — this is challenge placement, NOT restriction ranking, and these are personal pushes, not circle-chat posts. See §Adjacent. |
| `daily-summary-service.ts` (140–148) | Signal payload built for `daily_summary` | PASS | Payload is `{ checkedIn, total }` only — participation counts. Never calories, never weight. `checkedIn` derived from `engagement_activities` row presence (124–133), a boolean "did something today", not a quantity of food/exercise. |
| `chat-notification-service.ts` `truncatePreview` (209–214) | Empty preview → `PHOTO_PREVIEW` constant | PASS | Photo-message fallback is a fixed neutral string, not user content. |

---

## 3. Violations found

**None.** No copy ranks by restriction, shames a lapse, labels food, or broadcasts a weight/body/calorie number.

(Searched all reviewed sources for the §6.7 forbidden classes — restriction ranking, streak-break/guilt framing, good/bad-food + cheat/guilt-free labels, and weight/measurement/beverage broadcasts. The only "streak" copy is celebratory — `streak_milestone` line 137, `circle_streak` line 140 — never a "you broke your streak" message; lapse framing in the broader notification set, e.g. `momentum_at_risk`/`dormant_*`, is private momentum messaging, not circle-chat copy, and is explicitly non-shaming, e.g. `dormant_30d` line 168 "No judgment".)

---

## 4. Gaps in the automated eval safety scan + recommendations

The scan lives in `system-post-engine.eval.test.ts` (234–277): a forbidden-substring regex set run over every `renderCopy()` output via `allEventTypeCopyInputs`, plus a `notable_meal`-has-no-digit assertion. Strong as far as it reaches, but its reach is **only the system-post renderer**. Gaps:

### Gap A — Notification-orchestrator copy is unscanned
The `chat_*` (and all other) `NOTIFICATION_TEMPLATES` are never run through the forbidden-substring patterns. A future edit to `chat_rally`'s fallback or any circle/summary template could introduce food/weight/restriction language with no test failure.
**Recommendation:** Add a sibling eval that renders every `NOTIFICATION_TEMPLATES[type](sampleData)` (at minimum the circle-context types: `chat_message`, `chat_mention`, `chat_rally`, `circle_boost_threshold`, `perfect_day`, `friend_joined_circle`) and asserts the **non-preview** fields (`title`, and `body` for non-preview types) match the same `forbiddenPatterns`. Exclude the raw-`preview` body from the scan (it's user content — see Gap C).

### Gap B — `daily_summary` numeric fields aren't constrained to be calorie/weight-free
The scan checks the rendered string for digit-adjacent `cal/kcal/lbs/kg` tokens, but the `daily_summary` template (engine 151–155) interpolates `checkedIn`/`total` with no test guaranteeing those slots can never carry a body number, nor that `daily-summary-service.ts` only ever populates counts. Today it's safe (payload is `{checkedIn,total}` participation counts), but it's enforced only by convention.
**Recommendation:** Extend the scan to assert `daily_summary` rendered copy contains no calorie/weight token and that any digits are immediately followed by `of`/`checked`/`days` (count grammar), not a unit. Add a unit test on `DailySummaryService` asserting the built signal `payload` keys are a subset of `{checkedIn,total}` — a structural guarantee that a body metric can never be added silently.

### Gap C — The `@mention` / message preview echoes raw user text and is uncovered
`chat_message` / `chat_mention` body is `truncatePreview(preview)` — verbatim human-typed message text. It cannot be template-guaranteed neutral and the eval does not (and structurally cannot) assert its content.
**Recommendation:** Do **not** add a content scan here (it would be censoring user speech in a private circle, out of scope for §6.7 which governs *system-emitted* copy). Instead, add an explicit eval/comment documenting that the preview is user content, asserting only the **chrome** (title format, truncation to `PREVIEW_MAX_LENGTH`, photo fallback) — so the boundary "system copy is guaranteed, user copy is passthrough" is codified and a reviewer can't mistake the preview for system copy.

### Gap D — Hard-exclusion list isn't asserted against the notification layer
The eval proves a `weight` *signal* is suppressed by the engine (test 5, lines 162–178), but nothing asserts the `HARD_EXCLUDED_SOURCES` tokens never appear in any notification template either.
**Recommendation:** In the new notification eval (Gap A), also assert no rendered `title`/`body` contains a `HARD_EXCLUDED_SOURCES` term (`weight`, `body measurement`, `beverage`, `alcohol`) adjacent to a digit/value.

---

## 5. Specific risk investigated — raw preview in push

`chat_message` / `chat_mention` (`notification-orchestrator.ts` 270–279) set the push **body to the raw, user-typed message** (`data.preview`, produced by `chat-notification-service.ts` `notifyNewMessage` 45/63–66, truncated by `truncatePreview` 209–214).

**Assessment: ACCEPTABLE.** This is user-authored content surfaced as a DM-style preview of what a human typed in their own private circle — the standard, expected behavior for any chat app's push notifications. §6.7 governs **system-emitted** copy (templates the product writes), not speech between members. Forcing system-side neutrality scrubbing on a person's own message would be both out of scope and a speech-integrity problem. The template **chrome** around it (title, truncation, photo fallback) is system-controlled and neutral. Recommendation is to *document* this boundary (Gap C), not to scan the content.

**`notable_meal` (config-gated OFF) carries NO number — CONFIRMED.** Template (engine 163–164) is `` `${names[0]} logged a ${payload?.mealDescriptor ?? 'meal'} 🍽️` `` — interpolates only the textual `mealDescriptor` (type comment: "NEVER calories", contract line 33). Eval lines 268–276 assert the output equals `"Priya logged a high-protein lunch 🍽️"` and `expect(/\d/.test(out)).toBe(false)`. It also ships dark (`enabledByDefault:false`, taxonomy line 58; suppression eval test 6, 180–198).

### Adjacent observation (not a §6.7 violation, flagged for awareness)
`challenge_halfway` (228) and `challenge_completed` (238) interpolate `#${data.rank}`. This is **challenge leaderboard placement**, not ranking by restriction/eating-least, and these are **private momentum/challenge pushes, not Circle Chat posts** — outside this gate's surface. No action required for §6.7; noting only so a future reviewer doesn't conflate "rank" here with the restriction-ranking prohibition.

---

## 6. Sign-off checklist — §6.7 rules → enforcement point

| §6.7 Rule | Enforced where | Status |
|---|---|---|
| 1. Never rank by restriction / "ate least / lost fastest" | No template ranks members; bundle copy frames the group ("all got moving", "everyone's doing"). Eval forbidden patterns `restriction ranking` + `fattest/skinniest` (test 245–246). | Code + Eval |
| 2. Never shame a lapse / no guilt framing | No streak-break or guilt template exists; streak copy is celebratory (137, 140). Eval patterns `guilt`, `shame` (242, 244). Non-chat momentum copy explicitly non-judgmental ("No judgment", 168). | Code + Eval (system posts); Human (notification tone) |
| 3. Food-neutral — no good/bad/cheat/guilt-free, no calorie/weight numbers broadcast | `mealDescriptor` text-only (33, 163); no calorie field on `SignalPayload`. Eval patterns `cheat`, `bad food`, digit-adjacent `cal/kcal` + `notable_meal` no-digit assertion (236–246, 268–276). | Code + Eval |
| 4. No sensitive broadcasts — weight / measurements / alcohol-beverage never in post copy | `HARD_EXCLUDED_SOURCES` (engine 54, 56–58); suppression eval test 5 (162–178); weight-unit regexes (239–240). **Notification layer not asserted — Gap D.** | Code + Eval (engine); **Gap (notification layer)** |
| 5. Tone supportive/celebratory "update" not a journal log | Pinned exact-copy cases for all templates (eval 221–232 + `pinnedCopyCases`) break if copy regresses to a dry log. | Eval + Human |
| Coverage of notification templates (cross-cutting) | — | **Gap A/D — recommend new eval** |
| Coverage of `daily_summary` numeric slots (cross-cutting) | Convention only in `daily-summary-service.ts`. | **Gap B — recommend structural assertion** |
| Raw user preview boundary (cross-cutting) | Intentionally uncovered; standard chat behavior. | **Gap C — recommend documenting boundary** |

---

*Audit performed read-only. No files other than this report were created or modified.*
