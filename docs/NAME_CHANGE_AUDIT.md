# Name change audit — "change your name in Profile, reflected everywhere"

2026-11-02 · branch `feat/name-change-everywhere` (FitCircleBE, FitCircle-iOS, Fitcircle-Android)

Product ask: users can change their name from Profile, and the new name shows everywhere.

## 1. The name rule (all platforms)

`profiles.display_name` is the only source of truth for the name people see.
`profiles.username` is the separate @handle (3–30 chars, unique). Clients
show `display_name`, with `username` as the fallback only when the name is
empty.

The rule lives in `apps/web/app/lib/validation/display-name.ts`. iOS and
Android mirror it so they can validate inline.

1. Unicode NFC.
2. Control characters and invisible format characters (ZWSP, ZWNJ, bidi
   overrides, BOM) are removed, along with blank-looking letters (Hangul
   filler, braille blank). Tabs and newlines become spaces. ZWJ is kept so
   emoji sequences still render.
3. Runs of whitespace collapse to one space, and the ends are trimmed.
4. 1–40 characters, counted as grapheme clusters, with at least one letter,
   digit or emoji.
5. No `<` or `>`.

| Write path | Behaviour |
|---|---|
| `PUT /api/mobile/profile` (iOS, Android, web) | Applies the rule strictly. An invalid name returns 400 `VALIDATION_ERROR` with `details.displayName`. A name equal to the stored one (after normalization) is accepted and not rewritten, so clients that echo the whole profile with a legacy name never fail. |
| Register, Apple/Google sign-in, web signup bootstrap, `/api/onboarding/profile` | `coerceDisplayName`: same normalization, `<>` removed, cut to 40, username as fallback. Never rejects, because shipped clients send these. |
| `MobileAPIService.updateUserProfile` | Uses `cleanDisplayName` instead of `sanitizeDisplayName`. **Bug fixed:** the old sanitizer removed every non-ASCII letter ("José" was stored as "Jos", "李雷" as ""). |
| Web onboarding (`hooks/useProfile.ts`) | Still writes `profiles` directly with the Supabase client (RLS). Not covered by server validation. See open questions. |

Prod snapshot (read-only query, 2026-11-02): 145 profiles. 0 names over 40,
0 blank, 0 containing `<>`. 2 contain non-ASCII characters and 2 have
non-normalized whitespace. No backfill is needed.

## 2. Backend and data sources

"Live" means the name is resolved from `profiles` when the data is read or
sent, so a rename is picked up on the next fetch.

| # | Source | Where | Stale after a rename? | Decision |
|---|---|---|---|---|
| B1 | `profiles.display_name` | table | — | Source of truth. |
| B2 | `profiles.username` | table | — | Separate handle; edited in Edit Profile (409 `USERNAME_TAKEN`). Not changed by a name edit. |
| B3 | `public_profiles` view | `000_baseline.sql` | No (view over profiles) | Keep. |
| B4 | `auth.users.raw_user_meta_data` (`full_name`/`name` from Google/Apple/web signup) | GoTrue | Yes, before this change. 10 of 145 prod users already differ from their profile. | **Fixed.** On a name change the PUT route calls `MobileAPIService.syncAuthMetadataName`, a best-effort merge of `full_name`, `name` and `display_name`. Readers: web `auth-store.ts` (fallback only when `display_name` is empty) and `profile-bootstrap.ts` (only when creating a row). No existing rows are backfilled, because that would be a prod write; both readers prefer the profile anyway. |
| B5 | `toMobileUser` / `toMobileProfile` | `mobile-profile-response.ts` | No | Reads `row.display_name` on every response, with username as fallback. Keep. |
| B6 | Chat `sender.name` | `circle-chat-service.ts` `mapRowsToDTOs` | No | Already batch-joined from `profiles` per page. Keep. |
| B7 | System-post actors (`system.actors[].name`) | same | Partly: a name stored in the payload took precedence over the profile | **Fixed.** `normalizeActors` now prefers the current profile name. A stored name is only used for non-profile actors. In prod, 0 rows store actor names; posts store `{id}`. |
| B8 | System-post **body text** ("Ani's on a 14-day streak — nice") | `circle_messages.body` | Yes | **Kept by design.** Historical text stays as written, like Slack. Live UI that shows who posted (chips, avatars, sender rows) uses B6/B7. |
| B9 | Bundled system-post copy ("Ani, Sam all got moving today") | `system-post-engine.ts` `loadStats` | Yes. It also rendered **blank** names for earlier actors, because their stored actors have no name. | **Fixed.** `recentSameTypeInWindow` names are now resolved from `profiles` at render time. |
| B10 | Cheer `system_payload.cheer.to_display_name` | `circle-cheer-service.ts` (written), `circle-chat-service.ts` (read) | Yes | **Fixed.** The DTO renders the recipient's current name through a profiles join (`withLiveRecipientName`) and falls back to the stored copy when the profile is gone. Web `MessageBubble`, iOS and Android all read the DTO. |
| B11 | Cheer `body` text ("👏 Ani — …") | `circle_messages.body` | Yes | **Kept by design** (history; the structured card uses B10). |
| B12 | Chat inbox `last_message.sender_display_name` | `chat-inbox-service.ts` | No (profiles lookup per request) | Keep. |
| B13 | Chat push and cheer push copy (sender name) | `chat-notification-service.ts` | No (resolved at send time) | Keep. A push already delivered shows the old name; that is OS history. |
| B14 | `@mention` matching | `chat-notification-service.ts` | No (live display names) | Keep. Old messages that mention the old name stay as typed. |
| B15 | Leaderboards: `fitcircle_leaderboard_entries`, `leaderboard`, steps leaderboard, challenge participants, daily challenge participants | `leaderboard-service(-v2).ts`, `circle-steps-leaderboard-service.ts`, `circle-challenge-service.ts`, `daily-challenge-service.ts` | No. The tables hold ids, ranks and values only; names are joined at read time. | Keep. |
| B16 | Circle members, check-ins, data submissions, group meals | various services | No (joined) | Keep. |
| B17 | Daily circle summary posts | system-post body | Yes (body text) | Kept by design, same as B8. |
| B18 | Fitzy first name in the prompt context | `fitzy-service.ts` | No (read per request) | Keep. `fitzy_memory.items` stores no name. Past Fitzy replies that say the old name are history. |
| B19 | Fitzy push | `fitzy_push_deliveries` | No name stored | Keep. |
| B20 | Campaign push and email placeholders (`{first_name}`) | `campaign-delivery-service.ts` | No (resolved per send) | Keep. |
| B21 | Referral invite copy and inviter name on the join screen | `referral-service.ts`, `referral-invite-service.ts` | No (resolved per request) | Keep. `referral_invites.name` is the *invitee's* name as typed by the inviter, not the user's own name. Keep. |
| B22 | `notifications.title/body`, `notification_log.title/body` | tables | Yes | **Kept by design.** These are delivered notification history. |
| B23 | Supabase edge functions (`ai-coach`, `send-notifications`, `generate-insights`) | `supabase/functions` | No (read profiles per run) | Keep. |
| B24 | Supabase Auth email templates | `supabase/config.toml` | Not used (no `.Data.full_name`) | N/A. |
| B25 | Stripe customer | `billing-service.ts` | No name sent (email + `app_user_id` only) | N/A. |
| B26 | RevenueCat subscriber | — | Clients don't set `$displayName` | N/A. |
| B27 | Amplitude/PostHog user properties | `analytics/tracking-plan.json` | No name is ever sent (privacy convention) | N/A. The new event `Profile Name Changed {entry_point}` carries no name. |
| B28 | Engage (in-house messaging) | parked on `feat/engage` | — | When it ships, templates must resolve names at send time; don't snapshot them. |

### Schema snapshot check

`__tests__/fixtures/db-schema-snapshot.json`, name-like columns:

- `profiles.username`, `profiles.display_name` and `public_profiles.*` are the sources.
- `circle_messages.system_payload` (cheer and actor copies) is B7 and B10.
- `referral_invites.name` is the invitee, B21.
- `fitzy_daily.payload` holds plan and focus content and stores no user name.
- `notifications.*` and `notification_log.*` are B22.

Every other `*_name` column names a thing (a challenge, circle, food,
device or template), not a person. No new column is needed.

### Migration

**None.** No `name_updated_at` is needed: other clients pick up names on
their normal refetch, and the renaming client updates its own caches
optimistically. Migration 124 is not used.

## 3. Web (`apps/web`)

| # | Source | Stale? | Decision |
|---|---|---|---|
| W1 | `useAuthStore.user.name` (zustand, persisted to `localStorage` `auth-storage`) | Yes on other tabs until reload | The renaming tab updates it optimistically through `updateUser` and rolls back on error. Other tabs and devices rebuild it from `profiles` in `checkAuth()` on load. Keep. |
| W2 | Profile page Edit Profile **Save** | **Broken before this change.** `handleSave` was a TODO that showed "Profile updated successfully!" without saving anything. | **Fixed.** It now saves name and username through `PUT /api/mobile/profile` (`lib/api/profile-client.ts`). Email is shown read-only. |
| W3 | Header, navbar avatar and initials | Read W1 | Updates immediately. |
| W4 | Chat, leaderboards, members | Server DTOs (B6–B16) | Refetched. |

New entry point: tap the name (with a pencil), the avatar, or Account › Name
to open the "Your name" sheet. It has a live count (x/40), inline
validation, and Save is disabled when the name is invalid or unchanged. On
success, a toast reads `Name updated. Your circles now see "…".`

## 4. iOS

Entry point: tap the name, the avatar or the pencil in the Profile header,
or "Change name" in the Duo overflow menu, to open the "Your name" sheet
(`Features/Profile/EditName/EditNameFeature.swift`). Edit Profile now shares
the rule and the optimistic save path. A `SuccessBanner` confirms the save.
The rule is mirrored in `EditName/DisplayNameRules.swift`, where
`String.count` counts graphemes. `NamePropagation.swift` fans the change out
to the caches below, and it also applies a rename that arrives on a profile
reload (a change made on the web or another phone).

| # | Source | Path | Stale? | Decision |
|---|---|---|---|---|
| I1 | Profile user | `Features/Profile/ProfileFeature.swift` | Until reload | **Fixed.** Optimistic update and rollback; a reload can't overwrite a save in flight. |
| I2 | App current user | `Features/AppFeature.swift` | Yes | **Fixed.** |
| I3 | Home user and "Hi …" greeting | `DashboardFeature` (`homePro.displayName`) | Until reload | **Fixed.** |
| I4 | Cached profile (UserDefaults) | `Core/Storage/PersistenceManager.swift` | Saved only by Edit Profile | **Fixed.** Saved on every confirmed change. |
| I5 | Cached leaderboards (UserDefaults) | `Core/Cache/CacheManager.swift` | Yes: the old name painted first on circle open | **Fixed.** My rows are renamed in every cached board. |
| I6 | Open circle leaderboard, steps and standings | `CircleDetailFeature` | Yes | **Fixed.** Renamed in place, then refetched. |
| I7 | Chat inbox preview ("Ani: …") | `ChatInboxFeature` | Yes | **Fixed.** Renamed, then refetched. |
| I8 | Open chats' sender identity | `CircleChatFeature` | Until reload | **Fixed.** |
| I9 | Unsent chat messages in SwiftData (`ChatMessageDataModel`) | `Core/Services/CircleChatService.swift` | Yes | **Fixed.** Sent rows take names from the server, and my own bubbles don't show my name. |
| I10 | Widgets, Controls, Live Activity and Watch (App Group snapshot) | `SurfaceSnapshotWriter`, `PhoneWatchSession` | My initials in circle rings were stale | **Fixed.** Initials patched, then `WidgetCenter.reloadAllTimelines()`, a Watch push, and circles re-read. |
| I11 | Push and notification extensions | `NotificationsShared` | No local name cache | Kept. Names come in each push; delivered notifications are OS history. |
| I12 | Fitzy, Duo, home feed, share cards | — | No local copy | Kept (server names, or "You"). |
| I13 | Other users in chat, leaderboards, members, cheers and profiles | — | Server refetch on open | Kept. Only the cached boards could pin a name, and I5 fixes that. |
| I14 | Settings | `SettingsFeature` | Copied on open, name not shown | Kept. |
| I15 | Analytics and Sentry | — | Never receives the name | Kept. |

## 5. Android

Entry point: tap the name, the avatar or the pencil in the Profile header to
open the "Your name" bottom sheet (`NameEditSheet.kt`). Edit Profile shares
the same save path (`core/profile/ProfileNameUpdater.kt`), and a snackbar
confirms the save. The rule is mirrored in `core/profile/DisplayNameRules.kt`.
Java has no `Extended_Pictographic`, so emoji are matched by code-point
ranges; the server's answer decides. After a confirmed save,
`NameChangePropagator` updates the caches listed below. The `OwnNameChanges`
flow notifies live screens.

| # | Source | Path | Stale? | Decision |
|---|---|---|---|---|
| A1 | Profile screen state | `features/profile/ProfileViewModel.kt` | Until next load | **Fixed.** Optimistic update, rollback on failure. |
| A2 | Home greeting and Pro greeting | `features/dashboard/DashboardViewModel.kt`, `HomeProViewModel` | Until Home reloads | **Fixed.** Follows `OwnNameChanges`. |
| A3 | Cold-start Home snapshot | `core/data/LastKnownStore.kt` (`DashboardSnapshot`) | Until next refresh | **Fixed.** Rewritten after a confirmed save. |
| A4 | Room `leaderboard_entries` | `core/data/FitCircleDatabaseDaos.kt` | Yes | **Fixed.** `renameUser` update, no schema change. The repository currently has no callers. |
| A5 | Open chat: my sender name and my name on system-post actors | `features/circlechat/CircleChatViewModel.kt`, `ChatTimeline.kt` | While open | **Fixed.** Renamed in place. Old system-post body text is kept by design (B8). |
| A6 | Other people's names in chat | `ChatTimeline.mergeAuthoritative` | No | Kept. The server copy overwrites on refetch and resume. Older pages refresh when the chat is reopened. |
| A7 | Chat inbox last sender | `core/data/ChatInboxStore.kt` (memory) | Until refresh | Kept (server data, B12). |
| A8 | Home-screen widgets | `surface/SurfaceDataSource.kt` (15-min profile and 1-min circle caches) | Up to 15 min | **Fixed.** Forced refresh after save. Widgets render "You" for me. |
| A9 | Wear OS snapshot | `wear/WearSnapshotSource.kt`, `PhoneWearSync.kt` | Until next push | **Fixed.** Forced republish. The watch UI doesn't show my name. |
| A10 | Notification MessagingStyle Person and conversation shortcuts | `core/services/PushNotificationService.kt` | No for me (my Person is hard-coded "You") | Kept. Other senders' names come from each push. Already-posted notifications are OS history. |
| A11 | Circle members, standings, cheers, other users' profiles, circle streak | `CircleDetailViewModel`, `CircleStandingsPane`, `UserProfileViewModel`, `CircleStreakViewModel` | No | Kept (server refetch). |
| A12 | Share cards, body comp, Build Circle wizard | `features/share`, `features/bodycomp`, `BuildCircleWizard.kt` | No | Kept (fresh fetch, or rendered by the server). |
| A13 | Referral and campaign caches | `ReferralRepository`, `CampaignRepository` | Briefly | Kept (stale-while-revalidate). |
| A14 | Fitzy chat history (Room `fitzy_chat_messages`) | — | Old text mentions the old name | Kept by design (history). |
| A15 | Onboarding account store | `features/onboarding/OnboardingAccountStore.kt` | n/a | Kept. Onboarding only, then cleared. |
| A16 | Analytics and Sentry | `core/analytics/Analytics.kt` | n/a | Never receives the name. |

## 6. Verification (2026-11-02)

- **Backend:** vitest 278 files, 3739 passed, 7 skipped. `tsc --noEmit -p apps/web` is clean apart from the 3 known symlink errors. The DB contract test passes, and `analytics:check` is OK for web, iOS and Android.
- **iOS:** `build-for-testing` succeeds and the 23 new tests pass. DesignGuardsTests pass 4/4. The full run has 6 snapshot mismatches in screens this change doesn't touch (LargeLayout circle, OnboardingV3 home ×2, P0 circle chat, chat XXL, dashboard XXL). They look pre-existing after today's chat-hub merges but were not confirmed on a clean checkout.
- **Android:** `testDebugUnitTest lintRelease assembleDebug` passes: 2223 tests and 36 new, 0 failures, 0 lint errors.

## 7. Open questions

1. **Web onboarding** (`hooks/useProfile.ts`) still writes `profiles.display_name` directly through the Supabase client, so it bypasses the server rule. Should it move to `/api/onboarding/profile`, where the name is coerced? Separately, does RLS migration 118 still allow that direct write?
2. **ZWJ handling differs.** iOS keeps a ZWJ only between two emoji; the server and Android keep any ZWJ that isn't on its own. The only effect is that a stray ZWJ inside letters is stored server-side. The server's returned name wins on the client after a save.
3. **Auth metadata backfill.** 10 of 145 prod users have an auth `full_name`/`name` that differs from their profile. Nothing reads it while `display_name` is set, so there is no backfill. Run a one-off sync if Supabase Auth email templates ever start using `.Data.full_name`.
4. **History stays as written.** System-post and cheer body text, delivered notifications and Fitzy history keep the old name, like Slack. Confirm this is acceptable to product.
5. **Rename limits.** There is no rate limit or cooldown on renames. Add one if impersonation inside circles becomes a concern.

