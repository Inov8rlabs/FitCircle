# Food Entry Privacy — Spec

Status: backend built on `feat/food-entry-privacy` (not merged, not deployed). Clients (iOS, Android, web) to implement §6.
Owner request (2026-11-03): *"When I log my food entry it defaults to public and shares on all circles. I can't later on make those food entries private. Build this out properly."*

Owner decisions (2026-11-03), which override the first draft:
1. **New meals are PRIVATE by default.** The user preference "Share new meals with my circles" defaults to **OFF** for every user, existing users included.
2. **The flag can be changed on every edit surface, on every platform** (must-have).
3. **No backfill.** Existing rows are not changed. Only new entries follow the new default.

---

## 1. Behaviour

| | Behaviour |
|---|---|
| **Per-entry control** | A **"Share with my circles"** on/off control on every food logging surface (photo, voice, manual, quick add, search, barcode, re-log, Fitzy-launched flows) and on the entry detail/edit screen. It can be changed at any time. |
| **Turning sharing off** | The meal's cards leave every circle chat **before the API answers**. The stored chat rows are scrubbed (no title, macros or photo path). Its photo returns 403 to other members, and their HTTP caches expire within 5 minutes. |
| **Turning sharing on** | The meal is posted to each circle where the owner's tier is `full`. Members get a push **only if** the meal was eaten within the last **2 hours** AND was never posted before. Back-dated, old or re-shared meals post silently. |
| **Default for new meals** | `profiles.preferences.privacy.share_meals_with_circles` (bool, default `false`). It is stored server-side, so all devices agree. Changing it never touches existing entries. |
| **Visible state** | Every logging surface shows the current state as a chip, **"Private"** or **"Shared with circles"**, initialised from the default. Nothing is shared silently. |
| **Bulk** | Settings → Privacy → **"Make all past meals private"**, with a confirmation. It runs server-side, is idempotent and is safe to retry. "Share all past meals" is **deliberately not offered**: it would either flood every circle chat with history or create a "shared" state nobody can see. |
| **Owner action in chat** | On **your own** meal card in circle chat, a **"Make private"** action. It calls the edit endpoint with `share_with_circles:false`. |
| **Water / supplements** | Never shared. The server forces them private, whatever is sent. |
| **Per-circle tier** | Unchanged. `circle_food_privacy` (full / summary / private, default `full`) still decides which circles a *shared* meal reaches. Entry privacy is checked first: a private entry reaches no circle at any tier. |

### What "private" means
A private entry is **not shown** on any surface other members can see. It is also **not counted** in anything that reveals food data: name, photo, time, calories, macros, or averages.

**Decision on participation signals.** A private meal *does* still count as "logged something that day" for:
- streaks (personal and circle);
- campaign check-ins;
- the nutrition leaderboard's days-logged and adherence;
- a nutrition challenge's success days and adherence.

Those surfaces expose only a day count or a score, never food data. Excluding private meals would break streaks and challenges for everyone now that private is the default.

The one numeric food value a challenge shows about another member, `averageValue` (average daily calories, protein or carbs), is **hidden (null) for any member with a private entry in the window**. Their score still counts the entry.

---

## 2. API contract

All routes use the standard envelope `{ success, data, error, meta }`. Responses are `Cache-Control: private, no-store` unless noted.

### 2.1 Create — `POST /api/mobile/food-log` (changed)

New optional body field: **`share_with_circles: boolean`**. This is the user's explicit choice. New clients **always send it** for food entries, set from the chip.

How the stored privacy is decided, in this order:

| # | Request | Stored |
|---|---|---|
| 1 | `entry_type` is `water` or `supplement` | private |
| 2 | `share_with_circles` present | `true` → `is_private:false, visibility:'circle'` (`'shared'` if the request also has `visibility:'shared'`); `false` → private |
| 3 | legacy `is_private:true` or `visibility:'private'` | private (a request for privacy is always honoured) |
| 4 | anything else, including legacy `is_private:false` / `visibility:'circle'` | the user's default: `share_meals_with_circles` true → shared, else **private** |

**Why `is_private:false` from old clients is ignored.** Every shipped client sends `is_private` from a hard-coded default, so its `false` is not a user choice:
- **iOS 1.1.1:** `is_private` is always encoded. On phone it is `!shareWithCircles` with `shareWithCircles = true` (`NutritionConfirmFeature.swift:174`). The manual form defaults it to `false` (`FoodLogEntryFormFeature.swift:66`). Water hard-codes `false` (`HydrationClient.swift:27`).
- **Android 1.1.1:** `encodeDefaults = true`. `isPrivate` defaults to `false` in NutritionConfirm (`:91`) and the manual form (`:43`), and `visibility:'circle'` is derived from it.

A body field was chosen over a header or app-version gate, so that **offline-queued requests** keep their meaning: an outbox item queued by 1.1.1 and replayed after the app updates still has no `share_with_circles`.

Response: unchanged. `data.is_private` (bool) and `data.visibility` are present as before, and they always agree.

**Push.** A newly created *shared* meal pushes only if `now - logged_at ≤ 2h`.

### 2.2 Edit — `PATCH /api/mobile/food-log/{id}` (changed)

| Request | Effect |
|---|---|
| `share_with_circles:false` | private. Meal cards are retracted (tombstoned and scrubbed) **before the response**. If the retraction fails → 500; retrying is safe. |
| `share_with_circles:true` | shared. The card is posted after the response. Push only if eaten ≤ 2h ago AND never posted before. |
| legacy `is_private:true` / `visibility:'private'` | private (as above) |
| legacy `is_private:false` / `visibility:'circle'` | **ignored**. The entry keeps its privacy. A shipped Android whole-entry PATCH never re-shares a private entry. |
| no privacy field | privacy unchanged; the meal cards are refreshed |
| water / supplement + any privacy field | stays private |

The minimal body `{ "share_with_circles": false }` is valid on its own. The "Make private" action in chat uses it.
Response: unchanged shape (`data` is the full entry with `is_private` / `visibility`).

### 2.3 Read — `GET /api/mobile/food-log`, `GET /api/mobile/food-log/{id}`
Unchanged. Every entry carries `is_private` (bool) and `visibility` (`private|circle|shared`). Clients should treat an entry as shared **only if** `is_private == false` AND `visibility ∈ {circle, shared}`.

### 2.4 Default preference — `GET` / `PUT /api/mobile/food-log/sharing` (new)
```
GET  → 200 { data: { share_meals_with_circles: false } }
PUT  { "share_meals_with_circles": true } → 200 { data: { share_meals_with_circles: true } }
      400 VALIDATION_ERROR if not a boolean
```
The value is also readable as `preferences.privacy.share_meals_with_circles` in:
- `GET /api/mobile/settings/preferences`;
- every profile / user response (`toMobileUser`).

It is also writable through `PUT /api/mobile/settings/preferences` and `PUT /api/mobile/profile/preferences` (`privacy.share_meals_with_circles`).

Shipped clients re-send their whole privacy object without this key. The server merges, so their saves never reset it.

**Prefer the dedicated endpoint.** iOS re-sends the *whole* preferences object it loaded, so a stale copy could revert the value.

### 2.5 Bulk — `POST /api/mobile/food-log/sharing/bulk` (new)
```
{ "share_with_circles": false }
→ 200 { data: { entries_made_private: 12, posts_removed: 9 } }
{ "share_with_circles": true }  → 400 UNSUPPORTED
{}                              → 400 VALIDATION_ERROR
```
- Every live entry of the caller becomes private.
- Every live meal card of theirs is retracted, including cards of entries that were already private.
- It is idempotent: a second call returns zeros.
- The default for new meals is unchanged. Ask separately if you want to turn it off too.

### 2.6 Chat meal cards (behaviour change, no shape change)
- A retracted card is a normal tombstone (`deletedAt` set, `body: null`). Its `system.payload` is reduced to `{ render_hint, actors, entry_id }`.
- This applies both on REST and on the Realtime `UPDATE` row, because the stored row itself is scrubbed.
- Old tombstones, written before this change, still hold the meal in the stored row. REST scrubs them on read; see §5 for the one-off cleanup.
- Owner detection for the "Make private" action: `system.actors[0].id == me` (Realtime rows: `system_payload.actors[0].id`). The entry id is `system.refId`, or `payload.entry_id`.

---

## 3. Audit: circle surfaces and what was fixed

Line numbers are on `origin/main` (fdd9437) unless marked.

| # | Surface | Finding | Fix |
|---|---|---|---|
| L1 | Create default | `food-log-service.ts:97-98`: `is_private ?? false`, `visibility ?? 'circle'`. Omitted fields, and every client's hard-coded `false`, became **shared**. | §2.1 rules (`food-entry-privacy.ts`) |
| L2 | Edit re-shares | `food-log-service.ts:350-351` passed `is_private` / `visibility` straight through. Android 1.1.1 PATCHes the whole entry with `is_private:false, visibility:'circle'` (encodeDefaults). iOS 1.1.1 PATCHes the stored `is_private`. Any edit of a private entry from Android re-shared and re-posted it. | §2.2: legacy `false` is ignored |
| L3 | Columns disagree | PATCH with only `is_private:true` left `visibility:'circle'`. The feed (`circle-food-feed-service.ts:189`) filters on `visibility` only, so it showed such rows. | Both columns are always written together; the feed also requires `is_private=false` |
| L4 | Going private is not immediate | `food-log-service.ts:385` `void onMealUpdated(...)` ran fire-and-forget on serverless, with no `after()`, so the tombstone could be dropped. | The retraction is awaited before the response (`CircleMealPostService.retractMeal`); other refreshes go through `after()` |
| L5 | **Tombstoned meal cards still carry the meal** | `circle-meal-post-service.ts:364` set only `deleted_at`. `circle-chat-service.ts:927` serialises `system.payload` for deleted rows. Members can read `circle_messages` directly (RLS `circle_messages_member_select` and the Realtime publication). Title, calories, macros and `photo_path` stayed readable. Prod has **147** tombstoned meal posts with payload or body. | `tombstone()` nulls `body` and scrubs `system_payload`; REST scrubs old tombstones on read; §5 SQL for existing rows |
| L6 | Image proxy cache | `images/[imageId]/route.ts:197`: `Cache-Control: public, max-age=31536000, immutable`. A member's device kept a now-private photo for a year, and `public` allows shared caches. | Owner `private, max-age=86400`; others `private, max-age=300` |
| L7 | Image proxy auth | `viewerCanSeeEntry` → `isShareableMeal` honoured privacy. `isShareableMeal` treated `is_private: null/undefined` as shared (`:78`). | Fail closed: both columns must say shared |
| L8 | Explicit per-user share rows | `canViewEntry` (`food-log-service.ts:409`) granted access through `food_log_shares` regardless of privacy (RLS policy "Users can view shared food log entries" does the same). Prod has 0 rows, legacy `/share` route. | `canViewEntry` denies private entries to non-owners. The RLS gap is noted in §5 (not changed: 0 rows, no client uses it) |
| L9 | Food-log reactions | `addReaction` / `removeReaction` checked only shared membership (`circle-food-feed-service.ts:90`), so a member could react to a private entry by id. | `NotFound` for non-owners on private entries |
| L10 | Re-share pushes | `onMealUpdated` (`:248`) re-posted with a push for any re-share: old, back-dated, or flip-flopped. | Push only if eaten ≤ 2h ago and never posted before |
| L11 | Back-dated create pushes | `onMealLogged` pushed every shared create (`:205`), including yesterday's dinner. | Push only if eaten ≤ 2h ago |
| L12 | Nutrition challenge average | `nutrition-challenge-service.ts:179` showed every member's average daily calories, protein or carbs computed from all entries. | Null for other members with a private entry in the window; the score still counts it |
| L13 | Group meals | `group-meal-service.ts:258` inserted `visibility:'private'` without `is_private`. The DB default (`true`) saved it. | Explicit `is_private:true` |
| L14 | Server-created entries | Option-B parse-failure entries (`nutrition-intelligence-service.ts:688,756`) omit privacy, so they were shared. | Now follow the user default (private) |

**Checked and found OK, no change needed:**
- **Per-circle "summary" tier.** `FoodPrivacyService.filterEntriesForCircle` / `aggregateDaily` is not called by any route. No daily calorie or macro summary of a member reaches other members today. If it is ever wired up, map `hiddenByUser = isEntryPrivate(row)` (the type already drops such rows).
- **Daily summary chat post.** Counts check-ins only.
- **Streaks / circle streaks** (`circle-streak-service.ts:381`) and **campaign activity** (`campaign-activity-service.ts:44`). Day presence only (decision in §1).
- **Nutrition leaderboard** (`circle-food-feed-service.ts:325`). Days logged only (decision in §1).
- **Plate Score, Fitzy, nutrition coach, Fitzy push, meal reminders, vitals.** Self only.
- **Storage.** The `food-logs` bucket is private. The legacy feed signs URLs for 1 hour (residual: an already-issued URL lives ≤ 1h).
- **Home feed.** No member food content.
- **`notable_meal`.** Disabled by default, and carries no numbers.
- **Push notifications already sent** cannot be recalled. Nothing new is sent for private entries.

### Who defaulted to what (before this change)

| Surface | Default | UI to change on edit? |
|---|---|---|
| Server, field omitted | **shared** (`circle`) | — |
| iOS phone confirm screen (photo / voice / Kitchen Counter / onboarding) | shared (`shareWithCircles=true`). The toggle exists only in the iPad / Duo "After this meal" pane. | **No.** Edit keeps the stored value; the Duo pane is read-only in edit mode. |
| iOS manual form (manual / search / barcode) | shared (`isPrivate=false`) | Toggle only for meal or beverage categories. Edits of meals open the confirm screen, which has no toggle. |
| iOS re-log (widget / Siri / Watch) | copies the source; `true` if the source is missing | — |
| Android NutritionConfirm (photo / voice / search / barcode / onboarding) | shared (`isPrivate=false`) | PrivacyCard toggle, also in edit (but re-analyze-from-route drops `visibility`) |
| Android manual form | shared | toggle (meal / beverage) |
| Android water / widget / Wear | water `false`; re-log copies the source | — |
| Web manual form (`food-log-entry-form.tsx:97`) | **private** (`isPrivate=true` toggle) | no edit UI |
| Web photo / voice confirm (`NutritionConfirm.tsx:386`) | omitted → **shared** | edit (`:383`) sends no privacy |
| Prod data 2026-11-03 | food: 141 shared (17 users), 123 private (113 = the owner's manual fix, 10 by 2 users); water: 106 `circle`, 21 private | |

---

## 4. Analytics (tracking plan v25)

Canonical source: `FitCircleBE/analytics/tracking-plan.json`. Regenerated with `node analytics/codegen.mjs`.

| Event | Properties | When |
|---|---|---|
| `Meal Logged` (existing) | **+ `is_shared`** (bool, optional) | the choice at save time (food only) |
| **`Meal Privacy Changed`** (new) | `surface`: `log_screen\|edit_screen\|entry_detail\|chat_card\|settings_bulk`; `to`: `shared\|private`; `entry_count` (int, bulk only) | after the server accepts a change to a saved meal; bulk sends one event with `entries_made_private` |
| **`Meal Sharing Default Changed`** (new) | `enabled` (bool); `source`: `settings\|log_screen` | after `PUT /food-log/sharing` succeeds |

Generated files:
- **Web:** `apps/web/app/lib/analytics/events.generated.ts`, in this branch.
- **iOS / Android:** the scratchpad copies listed in the hand-off report. Copy them over the repos' generated files.

---

## 5. Data and migrations

- **No migration needed.** All columns exist:
  - `food_log_entries.is_private` (default `true`), `visibility` (default `'private'`);
  - `profiles.preferences` jsonb;
  - `circle_messages.body` is nullable.
- **No existing rows were changed** (owner decision). Only new entries follow the private default.
- **Recommended one-off cleanup (owner to approve; not run).** Scrub the 147 pre-existing meal-card tombstones that still store the meal. This is the stored data behind L5, readable through RLS and Realtime, not via REST:
  ```sql
  update circle_messages
     set body = null,
         system_payload = jsonb_strip_nulls(jsonb_build_object(
           'render_hint', system_payload->'render_hint',
           'actors',      system_payload->'actors',
           'entry_id',    system_payload->'entry_id')),
         updated_at = now()
   where system_event_type = 'meal_logged'
     and deleted_at is not null
     and (body is not null or system_payload ? 'title');
  ```
- **Known residual (not changed).** The RLS policy "Users can view shared food log entries" / images, based on `food_log_shares`, ignores `is_private`. There are 0 rows and no client writes them. If the `/share` route is ever revived, add `is_private = false` to those policies in a migration.
- **Backfill of other users** (making existing shared entries private): the owner will decide separately. `POST /food-log/sharing/bulk` is the per-user tool.

---

## 6. Client work (per platform)

All three clients must:
1. Send `share_with_circles` (bool) on **every food create**: online, offline outbox and re-log.
2. Show the chip on every logging surface.
3. Let the user toggle sharing on the **edit/detail screen**, sending `share_with_circles` on PATCH.
4. Add "Make private" on their own meal cards.
5. Add the Settings default and the bulk action.
6. Fire the analytics in §4.
7. Stop treating `is_private:false` as a choice.

**Initial chip state** = `share_meals_with_circles` from `GET /food-log/sharing`, or from the profile's `preferences.privacy`. Cache it locally; when unknown, **private**.

### 6.1 iOS (`/Users/ani/Code/FitCircle/FitCircle-iOS`)

**1. Wire model.** `FoodLogMetadata` (`FitCircle/Core/Models/FoodLog.swift:271-327`):
- add `shareWithCircles: Bool?` with CodingKey `share_with_circles`;
- keep `is_private` as is (old servers);
- set `isPrivate = !shareWithCircles` for food.

Water (`HydrationClient.swift:20-37`) needs no change (the server forces private).

**2. Local model / offline queue.** `FoodLogEntryLocal` (`Core/Storage/FoodLogDataModel.swift:24`):
- add `shareChoice: Bool?` (optional, so the SwiftData lightweight migration still works);
- `FoodLogService.syncEntry` (`Core/Services/FoodLogService.swift:470-487`) puts it in the payload for both create and PATCH;
- `syncFromRemote` (`:719`, `:743`) already overwrites `isPrivate`. Derive shared = `!is_private && visibility ∈ {circle, shared}`.

**3. Creation paths.** Pass the chip state at each of these call sites:
- `NutritionConfirmFeature.swift:1034-1047`. `shareWithCircles` must default to the server preference, not `true` (`:174`).
- `FoodLogEntryFormFeature.swift:612-628` and `:563-587`. `isPrivate` must default from the preference, not `false` (`:66`).
- Re-log `FoodLogService.swift:1003-1052` / Watch `:1518-1548`. Copy the source's state; if the source is missing, use the default, not `true`.
- `SurfaceMealEntry` has no privacy field (`Shared/Surfaces/SurfaceActionQueue.swift:93-111`), so use the default.
- Dead `FoodLogCameraFeature.swift:129` / `PhotoPickerFeature.swift:65` can be left alone or deleted.

**4. Chip on every surface.** Show the chip in the normal phone layout of the confirm screen; today the toggle exists only in `Duo/MealAfterPane.swift:198-209`, iPad/Duo only. Show it on the manual form (`FoodLogEntryFormView.swift:1024-1041`) for meals. Copy: "Shared with circles" / "Private".

**5. Edit (must-have).**
- Make `MealAfterPane` editable in edit mode (`:191-196`).
- Add the toggle to the meal edit path: `FoodLogEntryDetailFeature.swift:200-208` → `NutritionConfirmFeature` `EditContext.isPrivate` (`:273`, `:313`, `:1017-1030`).
- Add it to `FoodLogEntryDetailView.swift:126-134` (today a read-only label).
- PATCH sends `share_with_circles` (`APIClient.swift:1686-1699`).

**6. Chat "Make private".**
- `CircleChatView.swift:413-458` menu: for `kind == .systemEvent`, `renderHint == .mealCard`, `ChatSafetyFilter.authorId == me` (`Features/Safety/ChatSafetyFilter.swift:23-39`), add "Make private". It calls `PATCH /food-log/{refId}` `{share_with_circles:false}` and marks the local entry private.
- Duo variant: `Duo/DuoCircleChatView.swift:220-227`.

**7. Settings.**
- `PrivacySettingsView.swift`: add a "Share new meals with my circles" toggle (GET/PUT `/api/mobile/food-log/sharing`) and "Make all past meals private" with a confirmation dialog (`POST /api/mobile/food-log/sharing/bulk`).
- `PrivacyPreferences` (`Core/Models/User.swift:121-135`): add an optional `share_meals_with_circles` with a lenient decode. Do **not** send it through `PUT /profile/preferences`; that endpoint re-sends the whole object.

**8. Analytics.** Replace `FitCircle/Core/Analytics/AnalyticsEvents.generated.swift` with the v25 file. Fire `mealPrivacyChanged`, `mealSharingDefaultChanged`, and `mealLogged(isShared:)`.

**9. Decode.** No change needed (`FoodLogEntry` requires `is_private`, and the server keeps sending it).

**10. Tests.** Update `FitCircleTests/FoodLogSyncContractTests.swift:79-222` (body now has `share_with_circles`).

### 6.2 Android (`/Users/ani/Code/FitCircle/Fitcircle-Android/FitCircle/app/src/main/java/com/fitcircle/app/`)

**1. Wire model.** `FoodLogEntry` (`core/model/FoodLogModels.kt:152-200`): add `@EncodeDefault(NEVER) @SerialName("share_with_circles") val shareWithCircles: Boolean? = null`. Set it on every create and every PATCH that the user edited.
- `encodeDefaults = true` means `is_private` keeps being sent. The server ignores a legacy `false`, so that is harmless.
- **Do not** rely on `visibilityFor` (`:331-335`) for sharing any more.

**2. Room outbox.** The payload JSON (`core/data/foodlog/FoodLogEntryEntity.kt:62`, `FoodLogEntryMapper.kt:31-79`, `FoodLogOutbox.kt:135-160`) carries the new field automatically. No Room migration is needed.

**3. Creation paths.**
- `features/nutrition/confirm/NutritionConfirmViewModel.kt:1084-1102`: `isPrivate` defaults from the preference, not `false` (`:91`).
- `features/foodlog/entry/FoodLogEntryViewModel.kt:671-700`: defaults from the preference (`:43`); supplements send `share_with_circles` false or omit it (fixes the `is_private:false` + `visibility:'private'` contradiction at `:680-685`).
- Widget re-log `surface/SurfaceActions.kt:100-142`: the fallback at `:122` uses the default.
- Wear re-log `wear/AppWearActionPorts.kt:43-61`: copy the source.
- Water `FoodLogRepository.kt:390-405`: no change needed.

**4. Chip.** Show the "Private" / "Shared with circles" chip state on `PrivacyCard` (`NutritionConfirmScreen.kt:1234-1264`) and `CommonFieldsSection` (`FoodLogEntryScreen.kt:1585-1640`).

**5. Edit (must-have).**
- The PrivacyCard toggle in edit mode must send `share_with_circles`.
- Fix the re-analyze route `EditContext` (`navigation/MainScreen.kt:1354-1364`): it drops `visibility`, and a missing `editIsPrivate` defaults to `true` (`:1363`). Load the entry by id instead.
- `features/foodlog/detail/MealDetailScreen.kt:438-442`: make the "Shared" / "Private" row a toggle (PATCH `{share_with_circles}`).

**6. Chat "Make private".**
- `features/circlechat/ChatReactionRules.kt:179-198` + `SystemPostRenderer.kt:217-327`: for meal cards whose author (`ChatSafetyFilter.kt:37-60`) is the viewer, add "Make private" → PATCH `/food-log/{refId}` `{share_with_circles:false}`.
- `CircleChatViewModel.kt:1012-1016`: `isOwn` is false for system posts, so use the author.

**7. Settings.**
- `features/settings/PrivacySettingsView.kt:35-122`: add the default toggle (GET/PUT `/api/mobile/food-log/sharing`, separate from the batch Save) and "Make all past meals private" with confirmation (POST `/sharing/bulk`).
- `PrivacyPreferences` (`core/model/User.kt:92-99`): add `share_meals_with_circles: Boolean = false` for reading, but **do not send it** in `SettingsPreferencesUpdateRequest`. `encodeDefaults` would push `false` on every save. Mark it `@EncodeDefault(NEVER)` with a nullable type.

**8. Analytics.** Replace `core/analytics/AnalyticsEvents.generated.kt` with v25. Pass `isShared` to `mealLogged` at `FoodLogEntryViewModel.kt:630` and `NutritionConfirmViewModel.kt:1109`.

**9. Decode.** No change needed (`ignoreUnknownKeys`; `is_private` is still sent).

### 6.3 Web (`FitCircleBE/apps/web/app`)

**1. Create.**
- `components/food-log/food-log-entry-form.tsx:97,304,325`: send `share_with_circles: !isPrivate` for food. Initialise from the preference instead of `true`. Relabel the switch "Share with my circles".
- `components/nutrition/NutritionConfirm.tsx:386`: add the chip and send `share_with_circles`.
- `lib/api/nutrition-client.ts:395-405`: add `share_with_circles?: boolean` to `CreateFoodLogEntry`.

**2. Edit.**
- `NutritionConfirm.tsx:383` (`updateFoodLog`): send `share_with_circles` from the chip.
- Add a toggle to the entry detail (`components/food-log/nutrition-detail-dialog.tsx`) that PATCHes `{share_with_circles}`.

**3. Chat.** `components/chat/MessageBubble.tsx` `SystemPost`: "Make private" on your own `meal_card` (author = `system.actors[0].id`).
- Realtime UPDATE (`components/chat/CircleChat.tsx:143-199`) already receives `deleted_at`. Hide the card.

**4. Settings.** `settings/privacy/page.tsx`: the default toggle + bulk action (same endpoints).

**5. Analytics.** `lib/analytics/events.generated.ts` is already v25 in this branch.

---

## 7. Tests (backend, this branch)

- `apps/web/app/lib/services/__tests__/food-entry-privacy.test.ts`: the pure rules (create / update resolution, fail-closed `isEntryPrivate`, default parsing, 2h push window, payload scrub).
- `apps/web/app/api/mobile/food-log/__tests__/privacy.test.ts`: real routes and services over the fake DB.
  - **Create:** omitted fields → private; shipped iOS and Android bodies → private; default ON; explicit share (+ push); back-dated share (no push); water.
  - **PATCH both ways:** retraction before the response, scrubbed rows, a silent re-share of an old meal, one push across flip-flops, Android whole-entry PATCH never re-shares, iOS `is_private:true`, 403.
  - **Endpoints:** bulk (idempotent, UNSUPPORTED) and the default GET/PUT.
  - **One audit test per circle surface:** chat (incl. pre-fix tombstones), image proxy (403 + cache header), feed (incl. half-private rows), reactions, entry detail via share rows, nutrition challenge average, leaderboard participation, push.
- `apps/web/app/api/mobile/food-log/__tests__/shipped-client-compat.test.ts`: a new privacy section that replays shipped iOS and Android create, PATCH, list and detail, and checks they still decode with the shipped decoders.
