# FitCircle Invites & Referral Rewards — "Better Together"

Status: BUILDING (2026-10-15). Owner: Ani. Cross-platform: backend + web + iOS + Android.
This file is the contract for every client. Change it first, then the code.

## 1. The loop

```
 Member ──(creates circle / opens hub)──► shares personal link or circle link
    ▲                                              │
    │ week of Pro, celebration, badge              ▼
    │                                  Friend opens link (landing page / app)
    │                                              │ install (Play referrer / paste / typed code / universal link)
    │                                              ▼
    └──── friend logs first activity ◄── friend signs up, joins the circle (attributed)
                                                   │
                                                   ▼
                                  friend is now a member who can invite (loop restarts)
```

Why this shape (research summary, sources in the PR / chat log):
- **Invite to a circle, not to the app.** Strava found early-social users were more than twice as likely to still be active at 6 months, and Duolingo found Friend Streak users 22% more likely to complete the daily lesson. The circle *is* the product, so the invite is the product's core action (Partiful, Locket and Strava all work this way).
- **The reward is more of the product: a free week of Pro, on both sides.** This mirrors Duolingo's "you and a friend each get a week of Super". Prosocial "give" framing raised referral rates by 60–86% at the same reward (Jung et al., ISR 2020), so copy leads with the friend and the accountability, and puts the reward second.
- **Reward deep in the funnel.** The inviter's week unlocks when the friend logs their *first activity*, not when they install. That defeats throwaway signups, and it gives the inviter a reason to nudge their friend, which is more engagement on both sides.
- **Endowed progress plus goal-gradient.** Creating the circle counts as step 1, five seats are visible, and "1 more friend to your next badge" is shown. Milestone badges add delight at zero cost.
- **Policy.** Apple 3.2.2(x) allows rewarding in-app actions. The invitee's week is tied to their first check-in, never to "download/register" (Apple has rejected that wording). Paid features are never gated behind inviting (3.1.2(a)). Invites go through the share sheet only, with no Contacts permission (5.1.1/5.1.2). Google Play does not restrict user-to-user referral rewards, and no reward is ever tied to ratings or reviews.

## 2. Rules (server constants — `lib/referrals/referral-policy.ts`)

| Rule | Value |
|---|---|
| Inviter reward per qualified friend | **7 days Pro** (stacks, no annual cap) |
| Lifetime threshold | **100 qualified friends ⇒ Lifetime Pro** |
| Invitee reward | **7 days Pro**, unlocked by the invitee's first activity. Env `REFERRAL_INVITEE_REWARD_DAYS` (0 disables). |
| Attribution window | A user can be attributed within **7 days of account creation**, once. |
| Qualification | Invitee completed onboarding **and** has ≥1 activity day (a `streak_claims` row, excluding freeze/retroactive) within **30 days** of attribution |
| Self / cycle | inviter ≠ invitee. The inviter's own referrer can't be the invitee. |
| Device | If the client sends `deviceId`, it is hashed (sha256 + `REFERRAL_DEVICE_SALT`). Rejected if the device belongs to the inviter or to another account created before the invitee. |
| Disposable email | Invitee email on the blocklist ⇒ rejected at qualification |
| Velocity | More than 10 qualifications for one inviter in a rolling 24h ⇒ new ones go to `review` (no reward until an admin approves) |
| Clawback | Admins can revoke a referral. Unapplied (banked) days are revoked; applied grant time is reduced. |
| Program switch | `feature_flags.name='referrals'` (fail-closed) AND subscriptions enabled. When off, the hub returns `enabled:false` and clients hide every entry point. |

### Reward application ("Pro time bank")
- Every reward is a ledger row (`referral_rewards`). It starts `banked` and becomes `applied`.
- **Not paying through a store** ⇒ banked days apply immediately. One `complimentary_grants` row with `granted_by='referral-program'` is extended to `max(now, current_expiry) + days`.
- **Paying through App Store / Play / Stripe** ⇒ days stay banked and apply automatically when the store subscription ends. The hook is `ComplimentaryGrantService.holdIfGranted`, which every downgrade path already calls. Nobody pays for time they earned for free.
- **Lifetime** ⇒ a grant with `expires_at = NULL` (`granted_by='referral-lifetime'`), applied immediately even for payers. The hub tells payers they can cancel their store subscription.
- Idempotency: unique `(referral_id, kind)` on the ledger, and a partial unique index of one lifetime row per user. Grant extension uses compare-and-set on `expires_at` and retries.
- Expiry precision: the hourly `/api/cron/referrals` drops expired promotional profiles (via `syncFromRevenueCat` → hold/downgrade), so a week is a week, not "a week plus up to 30h".

### Milestones (badges, shown in the hub; only 100 carries Pro)
| count | key | title | blurb |
|---|---|---|---|
| 1 | `first_friend` | First Recruit | "Your first friend is in. That's how it starts." |
| 3 | `crew` | Crew | "Three's a crew. Accountability unlocked." |
| 5 | `full_circle` | Full Circle | "Five friends. Your circle is complete." |
| 10 | `squad_leader` | Squad Leader | "Ten people moving because of you." |
| 25 | `captain` | Captain | "You're building a movement." |
| 50 | `legend` | Legend | "Halfway to forever." |
| 100 | `lifetime` | Lifetime Pro | "100 friends. Pro is yours for life." |

## 3. Links & attribution (no Branch/AppsFlyer — Firebase Dynamic Links died 2025-08-25)

Canonical host: `https://www.fitcircle.ai`.

| Link | Meaning |
|---|---|
| `/i/{REFCODE}` | personal invite (no circle) |
| `/join/{CIRCLECODE}?ref={REFCODE}` | circle invite from a specific member (`ref` optional; missing ⇒ inviter = circle creator) |

- `REFCODE`: 4–12 chars matching `[A-Z0-9]`, generated from the first name plus 3 random chars (e.g. `MAYA7K2`), and never starting with `FIT`. Circle codes match `^FIT-?[A-Z0-9]{6}$`, so a single typed code is unambiguous.
- **Installed app:** iOS universal links (AASA at `/.well-known/apple-app-site-association`, appID `5CM376P74G.com.inov8rlabs.apps.fitcircle`, paths `/i/*`, `/join/*`) and Android App Links (`/join/`, `/i/`).
- **Android fresh install:** the landing page sends the user to Play with `&referrer=` + urlencode(`fc_ref=REFCODE&fc_circle=CIRCLECODE`). The app reads it once with the Play Install Referrer API on first launch.
- **iOS fresh install:** the landing page's "Get the app" first copies `FitCircle invite: <link>` to the clipboard (a visible step). The app's "Got an invite?" step shows a system **PasteButton** (no paste alert).
- **Typed code (everywhere):** onboarding "Got an invite code?" and the hub's "Enter an invite code" (until the 7-day window closes).
- Clients persist the pending code (UserDefaults / SharedPreferences, 7-day TTL) from link-open until a successful claim after signup.
- **Parsing (clients):** accept a bare code, `.../i/CODE`, or `.../join/CODE?ref=REF`, case-insensitive; strip `-` and spaces when comparing; uppercase.

## 4. API (all mobile routes: standard envelope `{success,data,error,meta}`, Bearer auth)

### `GET /api/referrals/preview?code=XXX[&ref=YYY]` (public, no auth)
Resolves either kind of code. 200 `data`:
```json
{
  "valid": true,
  "kind": "personal" | "circle",
  "code": "MAYA7K2",
  "inviter": { "firstName": "Maya", "displayName": "Maya R.", "avatarUrl": "https://…" | null },
  "circle": { "name": "Morning Movers", "inviteCode": "FITAB12CD", "memberCount": 4,
              "memberAvatars": ["https://…"], "challengeType": "step_count" } | null,
  "inviteeRewardDays": 7
}
```
An invalid code gives 200 `{valid:false}` (never 404, so landing pages render a friendly state).

### `GET /api/mobile/referrals` — the hub (also feeds the home card and the wizard)
```json
{
  "enabled": true,
  "code": "MAYA7K2",
  "shareUrl": "https://www.fitcircle.ai/i/MAYA7K2",
  "shareMessage": "…prefilled text incl. link…",
  "program": { "rewardDaysPerFriend": 7, "lifetimeThreshold": 100, "inviteeRewardDays": 7,
               "attributionWindowDays": 7 },
  "stats": { "invited": 6, "pending": 2, "qualified": 4, "daysEarned": 28, "daysBanked": 0,
             "hasLifetime": false, "toLifetime": 96 },
  "milestones": [ { "count": 1, "key": "first_friend", "title": "First Recruit", "blurb": "…", "reached": true } ],
  "nextMilestone": { "count": 5, "key": "full_circle", "title": "Full Circle", "blurb": "…", "remaining": 1 } | null,
  "invitees": [ { "id": "<referral id>", "displayName": "Sam", "avatarUrl": null,
                  "status": "pending" | "qualified" | "review" | "rejected",
                  "joinedAt": "ISO", "qualifiedAt": "ISO" | null, "circleName": "Morning Movers" | null } ],
  "pro": { "source": "store" | "referral" | "complimentary" | "none", "expiresAt": "ISO" | null,
           "lifetime": false, "bankedDays": 0 },
  "unseenRewards": [ { "id": "uuid", "kind": "inviter_week" | "invitee_welcome" | "lifetime",
                       "days": 7 | null, "friendName": "Sam" | null, "createdAt": "ISO" } ],
  "starterCircle": { "id": "uuid", "name": "Morning Movers", "inviteCode": "FITAB12CD",
                     "memberCount": 3, "shareUrl": "https://www.fitcircle.ai/join/FITAB12CD?ref=MAYA7K2",
                     "shareMessage": "…" } | null,
  "canClaimCode": true,
  "referredBy": { "firstName": "Jo", "avatarUrl": null } | null
}
```
- `starterCircle`: the user's most recent active circle where they are the creator, else null. It drives the wizard's "fill your seats" step and the home card's seat ring.
- `canClaimCode`: the account is younger than the attribution window and not yet attributed.
- Request header `X-FitCircle-Device: <IDFV / ANDROID_ID>` (optional): the server hashes it and remembers it for fraud checks only (the "inviter's own phone" rule).
- When `enabled:false`, every other field may be absent. Clients hide all referral UI.

### `POST /api/mobile/referrals/claim`
Body: `{ "code": "MAYA7K2" | "FITAB12CD", "ref"?: "MAYA7K2", "source": "universal_link"|"app_link"|"play_referrer"|"paste"|"typed"|"web"|"circle_join", "deviceId"?: "<IDFV / Android ID>" }`
- A circle code with no `ref` ⇒ inviter = circle creator, `circleId` recorded. The claim does **not** join the circle; clients join via `POST /api/mobile/circles/join {inviteCode, ref}` (that route also attributes on its own).
- 200 `data`: `{ "status": "pending", "inviter": {firstName, avatarUrl}, "circle": {id, name, inviteCode} | null, "inviteeRewardDays": 7 }`
- Errors (`error.code`): `INVALID_CODE` (404), `SELF_REFERRAL` (400), `ALREADY_ATTRIBUTED` (409; data still carries the existing inviter), `WINDOW_CLOSED` (422), `DEVICE_INELIGIBLE` (422), `PROGRAM_DISABLED` (403).
- Clients treat 409 and 422 as "done, clear the pending code". They show nothing alarming to the user.

### `POST /api/mobile/referrals/rewards/seen`
Body `{ "ids": ["uuid"] }` → `{ "updated": n }`. Called after the celebration plays.

### `POST /api/mobile/circles/join` (existing) — new optional `ref`
`{ inviteCode, ref?, goal? }` (and `POST /api/mobile/circles/{id}/join {inviteCode, ref?}`). After a successful join, attribution is attempted silently with `source:'circle_join'`. Join behaviour and errors are unchanged.

### `GET /api/mobile/circles/{id}/invite-link` (existing) — changed
`invite_url` is now `https://www.fitcircle.ai/join/{CODE}?ref={REFCODE}` (was `fitcircle://…`). Adds `referral_code` and `share_message`.

### `GET /api/mobile/entitlements` (existing) — additive
`subscription.source`: `"store" | "referral" | "complimentary" | null`. Lets Manage Subscription show "Pro until Oct 30 · earned by inviting friends" instead of "Free".

### Web
- `/i/[code]` and `/join/[code]?ref=` landing pages: server-rendered OG card ("Maya saved you a seat in Morning Movers"), a circle preview, store buttons (Play link carries the referrer), and copy-then-App-Store for iOS. The pages set a `fc_ref` cookie (7 days) for web signup.
- Web registration claims `fc_ref` (`source:'web'`) after the account is created.
- `/invite`: the web referral hub (the same data as the mobile hub, via `GET /api/referrals/me`, cookie auth).

### Admin (`Bearer ADMIN_API_SECRET`)
- `GET /api/admin/referrals?status=review`
- `POST /api/admin/referrals/{id}/approve`
- `POST /api/admin/referrals/{id}/revoke` `{reason}`

### Push (via NotificationOrchestrator, category `social`, cap-exempt, `screen: "invite_hub"`)
| type | title | body |
|---|---|---|
| `referral_friend_joined` | "{friend} joined with your invite 🎉" | "Their first check-in unlocks your free week of Pro. Say hi!" |
| `referral_reward_earned` | "You just earned a free week of Pro 🎁" | "{friend} logged their first activity. Thanks for bringing a friend." |
| `referral_reward_banked` | "+7 days banked 🎁" | "{friend} is in! Your free week is saved and kicks in when your current plan ends." |
| `referral_lifetime` | "Lifetime Pro unlocked 🏆" | "100 friends moving because of you. Pro is yours, forever." |
| `referral_invitee_welcome` | "Your week of Pro is unlocked ✨" | "A gift from {inviter} for showing up. Enjoy every Pro feature, on us." |

Clients add `invite_hub` to their push-screen allowlists and route it to the Invite hub.

## 5. Client surfaces (iOS + Android; web gets the hub and landing pages)

1. **Invite hub** ("Better Together"). Reached from the Home card, the Profile/Settings row "Invite friends · Get Pro free", the circle detail invite sheet, and push.
   - A hero ring shows qualified/next milestone. The big number is the free weeks earned.
   - Primary CTA "Invite friends" opens the share sheet with `shareMessage`. Secondary actions: copy link, show code.
   - "How it works" in 3 steps: Send your link → Friend joins & checks in → You both get a week of Pro.
   - A milestone ladder (badges, 100 = Lifetime).
   - A friends list with status chips: Joined · waiting for first check-in / Week unlocked ✓ / Under review. Pending rows get a "Nudge" button, a share sheet prefilled with "Hey {name}! Log your first check-in on FitCircle so we can keep each other honest 💪".
   - "Got an invite code?" entry while `canClaimCode`.
   - Pro status line ("Pro until Nov 2 · 3 weeks from friends" / "+14 days banked for when your plan ends" / "Lifetime Pro 🏆").
   - Fine print: "A friend counts when they join with your link and log their first activity. Rewards are free Pro time; they're never required for anything you've paid for."
2. **"Build your circle" wizard** (onboarding-style, skippable at every step, never blocks the app).
   - Step 1, Hook: "Fitness is better together". Five empty seats. "Every friend who joins = 1 free week of Pro. Bring 100 and Pro is yours for life."
   - Step 2, Name it: prefill "{FirstName}'s Crew", with vibe chips Steps · Workouts · Healthy eating · Weight. Creates the circle (existing create endpoint). Skipped if `starterCircle` exists.
   - Step 3, Fill your seats: a seat ring of 5. "Invite" opens the share sheet with `starterCircle.shareMessage`. A seat marks "Invited ✓" locally after a share completes. Joined seats show real member avatars (refreshed on foreground). Copy: "2 of 5 seats filled".
   - Step 4, Done: "Your circle is live 🎉" plus what happens next ("We'll ping you when friends join").
   - Triggers: once right after onboarding when the user has no circle; the Home card; the Circles empty state; the hub.
3. **Home feed card** (one at a time, dismiss = snooze 14 days, hidden when `enabled:false`).
   - No circle: "Start your crew → 5 friends = 5 free weeks of Pro" → wizard.
   - Circle with fewer than 5 members: seat ring "3 of 5 seats filled · invite 2 more" → share.
   - Pending invitee: "Sam joined! Their first check-in unlocks your free week" → hub.
   - Otherwise: "{qualified} friends in · {remaining} to {nextMilestone}" → hub.
4. **Celebration.** On launch/foreground, any `unseenRewards` gets a full-screen moment: confetti, haptic, "+7 days of Pro", the friend's name and an updated weeks counter. Lifetime gets a bigger moment. Then the client POSTs `rewards/seen`.
5. **Invitee welcome.** After claiming: "Maya saved you a seat 💜 — check in today and you both get a week of Pro." When the invitee's own reward unlocks, they get the same celebration.

## 6. Copy deck (use verbatim unless a platform needs to shorten it)
- Hub title: **"Better together"**. Subtitle: "Every friend who joins gets you both a free week of Pro."
- Hero number label: "free weeks earned". Lifetime progress: "{n} / 100 friends to Lifetime Pro".
- Primary CTA: **"Invite friends"**. Secondary: "Copy link", "Share code".
- Share message (personal): `I'm using FitCircle to stay on track, join me so we keep each other honest 💪 We both get a free week of Pro when you check in: {url}`
- Share message (circle): `Join my circle "{circle}" on FitCircle 💪 We keep each other honest. Check in once and we both get a free week of Pro: {url}`
- Home card headlines: "Don't sweat alone." / "Your circle has {n} empty seats." / "Accountability is a team sport."
- Wizard: "Fitness is better together" · "Name your crew" · "Fill your seats" · "Your circle is live 🎉".
- Avoid: guilt, fake scarcity, "download and get…", any suggestion that paid features need invites.

## 7. Analytics (tracking-plan.json, category `acquisition`)
`Referral Hub Viewed {source}`, `Referral Invite Shared {method, context}`, `Referral Card Shown/Tapped/Dismissed {state}`, `Circle Wizard Started {source}`, `Circle Wizard Step Viewed {step}`, `Circle Wizard Completed {invites_sent}`, `Circle Wizard Skipped {step}`, `Referral Code Claimed {source}`, `Referral Claim Failed {reason}`, `Referral Reward Celebrated {kind}`.
North-star funnel: hub/wizard view → invite shared → link opened → claimed → qualified. Also watch the K-factor (qualified referrals per active user per month) and D30 retention of referred vs organic users.

## 8. Data model — migration `100_referrals.sql`
See the migration. Tables: `referral_codes`, `referrals`, `referral_rewards`, `referral_devices`. RLS is on with no client policies, and all logic lives in `lib/services/referral-*.ts`.
