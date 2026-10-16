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

---

## 9. v2 (2026-10-16): invite by email or text, live friend status, nudges, reward delivery

### 9.1 Product
- **Invite by email or phone.** One smart field, "Email or phone number", plus an optional first name. Contacts collect as chips (max 10 per send). There's also a **Pick from contacts** button that uses the system picker (iOS `CNContactPickerViewController`, Android `ACTION_PICK` on the Email/Phone content URIs). No Contacts permission is ever requested.
  - **Emails:** the server sends a branded invitation via Resend, written as coming from the inviter ("Maya invited you to FitCircle"). It covers what FitCircle is, the circle (if any), the reward line and the personal link.
  - **Phone numbers:** the app opens the native SMS composer, one friend at a time (never a group text), prefilled with `smsBody`. The user presses Send from their own number. The app records the invite only after the composer reports it was sent (iOS `MessageComposeResult.sent`; on Android, returning from the composer counts). We do not send SMS from servers: there's no provider, and US 10DLC registration plus TCPA risk rule it out.
  - **Web:** emails as above. A phone number shows the message with Copy and an `sms:` link on mobile browsers.
- **One friends list with live status.** Sent invites and joined friends are merged:
  - `invited` (email/text sent, not joined): chip "Invited · email" or "Invited · text".
  - `joined` (attributed, no first activity yet): "Joined · waiting for first check-in".
  - `qualified`: "Week unlocked ✓". `review` shows as "Checking…".
- **Nudge** (optional, rate-limited, never automatic):
  - **Joined friend:** push to the friend: "{Inviter} is cheering you on 💪 Log your first check-in and you both get a free week of Pro." At most once per 48h per friend, 3 times in total.
  - **Invited by email:** a reminder email. At most 2 reminders per invite, at least 72h apart.
  - **Invited by text:** the composer opens with `nudgeSmsBody`; the server records the time. The same limits as email apply.
  - The UI shows "Nudged · again in 2d" when it's too soon, and no Nudge button once the limit is reached.
- **Reward delivery to both people, guaranteed.** When a friend qualifies:
  - **Inviter push:** `referral_reward_earned` / `_banked`.
  - **Invitee push:** `referral_invitee_welcome`.
  - **Email to both:** "You and {friend} each earned a free week of Pro 🎉", ending with an invite-more call to action.
  - **In-app celebration:** comes from `unseenRewards` for both people.
  - **Retries:** a push suppressed by quiet hours or failed delivery is retried by the hourly cron (`referral_rewards.notified_at`, `referrals.inviter_notified_at`) until it's sent or 48h old.
  - **Friend joined:** the inviter gets the `referral_friend_joined` push (also retried), and their invite row flips to `joined`.
- **Every celebration feeds the loop.** Celebrations (inviter week, invitee welcome, lifetime) carry a primary CTA, **"Invite friends — earn a week for each"**, which opens the invite sheet. The secondary action is "Done".
  - The invitee's welcome sheet after a claim adds a line: "Bring your own friends: every one who checks in earns you another free week."
  - Push copy (below) ends with a soft invite prompt. Nothing auto-prompts beyond the celebration moment, the home card and the hub.
- **Automatic attribution by email.** If someone signs up with an email that a member invited (within 30 days) and has no attribution yet, they're attributed to the earliest inviter (`source: 'email_invite'`). That happens on their first hub fetch or activity, within the 7-day window. Their circle invite (if any) is offered via `pendingCircleInvite` in the hub.
- **Opt-out.** Every invite email has a one-click unsubscribe (`/invite/unsubscribe?t=<signed token>`, plus the List-Unsubscribe header). An opted-out address can never be invited again, and the inviter sees "Can't invite this address".
- **Limits.**
  - 25 email invites per inviter per 24h, 200 pending in total.
  - The same contact can't be re-invited by the same inviter (they can nudge instead).
  - An email already on FitCircle returns `already_member` (no email is sent). This is rate-limited by the daily cap so it can't be used to enumerate accounts.
  - The inviter's own email is rejected.
- **Privacy.**
  - Emails are stored (needed for reminders), service-role only, and deleted once joined or after 45 days.
  - Phone numbers are never stored in plaintext: only a salted hash plus the last 4 digits for display.
  - Names are optional and shown only to the inviter.

### 9.2 API additions
`POST /api/mobile/referrals/invites` body:
```json
{ "contacts": [ { "email": "sam@x.com", "name": "Sam" }, { "phone": "+14165550123", "name": "Jo", "channel": "sms" } ],
  "circleId": "uuid"? }
```
- Max 10 contacts. An email contact is sent by the server. A phone contact means "I texted this person from my composer" (record only).
- `circleId`: an active circle the user belongs to. It defaults to `starterCircle`, and the email then invites to that circle.
- 200 `data`:
```json
{ "results": [ { "contact": "sa•••@x.com", "channel": "email", "name": "Sam",
                 "status": "sent" | "already_invited" | "already_member" | "opted_out" | "invalid" | "self" | "rate_limited" | "failed",
                 "inviteId": "uuid" | null } ],
  "sentCount": 1 }
```

`GET /api/mobile/referrals` (hub) additions:
```json
"invites": [ { "id": "uuid", "channel": "email" | "sms", "name": "Sam" | null, "contact": "sa•••@x.com" | "•••• 0123",
               "status": "invited" | "joined" | "qualified", "sentAt": "ISO", "lastNudgedAt": "ISO" | null,
               "nudge": { "available": true, "nextAt": "ISO" | null, "remaining": 2 } } ],
"invitees": [ { …existing…, "nudge": { "available": true, "nextAt": null, "remaining": 3 } } ],
"smsBody": "Hey! I'm using FitCircle … {link}",          // text for the composer (personal or starter-circle link)
"emailPreview": { "subject": "Maya invited you to FitCircle", "intro": "…first lines…" },
"pendingCircleInvite": { "circleId": "uuid", "name": "Morning Movers", "inviteCode": "FITAB12CD", "ref": "MAYA7K2" } | null
```
- `invites` holds only rows that haven't converted to an attributed referral yet (`status: invited`). Converted ones show up in `invitees`.
- Clients render one merged list: invites first, then invitees.

`POST /api/mobile/referrals/nudge` body: `{ "inviteId": "uuid" }` or `{ "referralId": "uuid" }`
- 200 `data`: `{ "status": "sent" | "too_soon" | "limit_reached" | "not_nudgeable", "nextAt": "ISO" | null, "remaining": 1, "smsBody": "…" | null }`
- For an SMS invite, `status:"sent"` comes with `smsBody`, and the client opens the composer with it.

Web: `POST /api/referrals/me/invites` and `POST /api/referrals/me/nudge` (cookie auth, same shapes). `GET /api/referrals/unsubscribe?t=` is the public endpoint behind the `/invite/unsubscribe` page.

### 9.3 Push copy (v2)
| type | title | body |
|---|---|---|
| `referral_friend_joined` | "{friend} just joined FitCircle 🎉" | "Your invite worked! When they log their first check-in, you both get a free week of Pro." |
| `referral_reward_earned` | "You both just earned a free week of Pro 🎁" | "{friend} checked in for the first time. Invite another friend for another free week." |
| `referral_reward_banked` | "+{days} days banked 🎁" | "{friend} checked in! Your free week kicks in when your current plan ends. Invite another friend for more." |
| `referral_invitee_welcome` | "You and {inviter} just earned a free week of Pro ✨" | "Thanks for showing up! Invite your own friends: every one who checks in earns you another week." |
| `referral_nudge` (new, to the friend) | "{inviter} is cheering you on 💪" | "Log your first check-in today and you both get a free week of Pro." (screen `dashboard`) |

### 9.4 Analytics (plan v7)
- `Referral Contacts Invited {channel: email|sms, count, source: hub|wizard|celebration|home_card}`
- `Referral Contact Picker Opened {}`
- `Referral Nudge Sent {target: invited|joined, channel: push|email|sms}`
- `Referral Celebration Invite Tapped {kind}`
- `Referral Invite Sheet Opened {source}`

---

## 10. v3 (2026-10-16): qualify on 3 days, lobby + seats, circle streak + save pool, seasonal circles, invite prompts at high points, activation

### 10.1 A friend counts after 3 check-in days
- **Rule:** an invitee qualifies once they've completed onboarding and checked in (any non-freeze `streak_claims` day) on **3 different days within 14 days** of attribution. This replaces "first activity / 30 days".
- **Copy:** "check in on 3 different days" (short form: "Check in 3 days and we both get a free week of Pro"). Clients read the number from `program.qualifyingDays`; never hardcode it.
- **Hub additions:**
  - `program.qualifyingDays`, `program.qualifyWindowDays`.
  - `invitees[].progress: { days, required, deadline }`. Render a progress bar on joined rows ("Sam · 2/3 check-ins").
  - Invitee side: `myReward: { days, required, deadline, status: 'in_progress'|'unlocked', rewardDays, inviterFirstName } | null`.
    - Home card state `my_reward` (highest priority while in progress): "2 of 3 check-ins — 1 more unlocks a free week for you and Maya". Shown with three dots.
    - The welcome sheet shows the same bar.
- **Push `referral_progress`** (to the invitee, once, when they're one day away): "One more check-in 🎁 — Check in tomorrow and you and {inviter} both unlock a free week of Pro." Screen: `dashboard`.

### 10.2 Seats + Lobby ("starts when your crew is in")
- **Create** (`POST /api/mobile/circles`) accepts optional `lobby: { minMembers: 2–6 }`. The server then:
  - sets `start_date` to now + 72h (auto-start) and `end_date = start + requested duration`;
  - stores `metadata.lobby = { minMembers, durationDays, openedAt, autoStartAt, startedAt: null }`;
  - leaves status `upcoming` (date-based, so every existing path still works).
- **Kickoff:**
  - **Full:** when active members reach `minMembers`, the circle kicks off right away. Start = today in the circle's timezone, end = start + duration, `startedAt` is set, the chat gets a `circle_kickoff` post ("We're 3! {Circle} starts now 🎉"), and every member gets a `circle_kickoff` push.
  - **Timer:** if the lobby hasn't filled by `autoStartAt`, the hourly cron kicks off anyway ("Let's go! {Circle} starts now — seats stay open for friends").
- **Circle payloads** (`GET /api/mobile/circles`, `/circles/{id}`, create response) gain `lobby: { minMembers, memberCount, needed, autoStartAt, startedAt } | null`. `null` means a normal circle.
- **Clients:**
  - **Lobby card** at the top of circle detail:
    - a seat ring with `minMembers` highlighted seats (filled avatars, dashed "+" empties);
    - "Needs 1 more to start" and "Starts automatically in 2d 14h" countdown;
    - primary "Invite friends" (the invite sheet), plus "Start now" for the creator (calls `POST /api/mobile/circles/{id}/start`).
  - **Seats:** every circle detail shows seats (filled avatars plus up to `max(5, minMembers)` empty "+" seats, each tap-to-invite), not only lobby circles.
  - **Wizards** (build-your-circle and create-circle) default to "Start when 3 friends join" (toggle on, `lobby.minMembers = 3`). The toggle says: "We'll kick off the moment your crew is in, or in 3 days, whichever comes first."
- `POST /api/mobile/circles/{id}/start` (creator only): kicks off now. `reason: 'manual'`.

### 10.3 Circle streak + shared save pool
- **What counts:** a day counts for a member when they have any real activity that day: a non-freeze `streak_claims` row (every meal, workout or check-in log claims its day), or a calorie-bearing food entry, or a save covering them. The circle day counts when a **strict majority** of active members count (unchanged rule).
- **Recompute triggers:**
  - on every new streak claim, for each of the member's active circles (that day);
  - the hourly cron recomputes the local "yesterday" for every circle with a live streak (so missed days reset);
  - every save.
- **Save pool:** every member brings **1 save per week** (Monday-based week in the circle's timezone) to the circle's shared pool. A member may cover someone who hasn't logged today or yesterday.
  - **Rules:** not themselves; the covered person hasn't logged that day; the saver's weekly save is unused.
  - **Errors (`error.code`):** `SAVE_USED` (409), `NOT_NEEDED` (400, they already logged), `SELF` (400), `DATE_OUT_OF_RANGE` (400).
  - **Effects:** chat post `circle_streak_saved` ("Sam covered Jo — the circle streak lives 🛡️") and push `circle_streak_saved` to the covered member ("Sam covered for you today 🛡️ — your circle streak is safe").
- **Milestones:** 3, 7, 14, 30, 50, 100 days produce a chat post (`circle_streak`, now enabled) and a `circle_streak_milestone` push to every member ("{Circle} hit a 7-day streak 🔥 — keep it rolling").
- **`GET /api/mobile/circles/{id}/streak`** (additive; old fields unchanged):
```json
{ "fitcircleId": "…", "currentStreak": 4, "longestStreak": 9, "lastActiveDate": "2026-10-15", "updatedAt": "…",
  "today": { "date": "2026-10-16", "loggedCount": 2, "activeCount": 5, "needed": 3, "qualified": false,
             "members": [ { "userId": "…", "displayName": "Sam", "avatarUrl": null, "logged": false, "covered": false, "coveredBy": null } ] },
  "saves": { "poolRemaining": 3, "poolSize": 5, "mySaveAvailable": true, "weekResetsAt": "ISO" },
  "nextMilestone": { "days": 7, "remaining": 3 } | null }
```
  `POST …/streak/save {coveredUserId, date?}` responds `{ save, created, streak: <same DTO> }`. **Android must decode `data.streak`** (current bug: it decodes `data` as the streak).
- **Clients (iOS and Android):** a Circle Streak card on circle detail, near the top:
  - flame plus `currentStreak`, "2 of 5 checked in today · 1 more keeps it alive";
  - member chips (✓ logged, 🛡️ covered, empty);
  - "Cover {name}" on not-logged chips while `mySaveAvailable`, and "Your weekly save is used — resets Monday" otherwise;
  - pool indicator "🛡️ 3 saves left this week";
  - next milestone line;
  - a milestone celebration (confetti) the first time the viewer sees a newly reached milestone.
- iOS currently doesn't show the circle streak at all; wire `CircleStreakCardView` (or rebuild it) into `CircleDetailView`.

### 10.4 Seasonal circles: `GET /api/mobile/seasonal` (auth)
```json
{ "current": Season | null, "upcoming": Season | null }
Season = { "key": "hold_the_line", "title": "Hold the Line", "emoji": "❄️",
           "tagline": "Maintain, don't gain — together.",
           "description": "From Nov 15 to Jan 1, your circle checks in daily and keeps each other steady through the holidays.",
           "startsAt": "2026-11-15", "endsAt": "2027-01-01", "featuredFrom": "2026-10-20",
           "circle": { "name": "Hold the Line Crew", "description": "…", "type": "custom", "startDate": "2026-11-15", "endDate": "2027-01-01" },
           "accent": "#38bdf8" }
```
- `current` is the season whose `featuredFrom` ≤ today ≤ `endsAt`. If the season starts in the future, its circle starts on `startsAt` (upcoming, no lobby; seats are promoted as "Fill your seats before Nov 15"). Otherwise it starts now with the lobby default.
- Seasons are configured in code (`lib/seasonal/seasons.ts`): Hold the Line (Nov 15–Dec 15, the pre-holiday push), Fresh Start (key `new_year_reset`; Jan 1–31, featured from Dec 15, promoted once Hold the Line ends), Ramadan 2027 (≈Feb 8–Mar 9, featured from Jan 25; copy says dates follow the moon sighting).
- **Clients** (during the `current` window only):
  - a seasonal banner on the wizard's hook/name step ("❄️ Hold the Line · Nov 15–Jan 1") that prefills name and dates;
  - a compact banner on the Circles tab;
  - home card state `seasonal` (just below `my_reward`).
  - Tapping opens the wizard with the season prefilled (`CircleWizardStarted source: seasonal`).

### 10.5 Invite prompts at high points (clients)
- **Moments:**
  - a streak milestone celebration;
  - a daily check-in celebration when the streak is ≥ 3;
  - a challenge progress milestone of 100% (or 50% if it's the first);
  - a circle streak milestone;
  - a lobby kickoff seen in-app.
- **Behaviour:** add a secondary CTA inside the existing celebration, "Bring a friend along →", which opens the invite sheet (`ReferralInviteSheetOpened source: peak_moment`). Never a separate modal.
- **Frequency:** at most 1 prompt shown per 7 days per user (local pref), never in the first session, never during onboarding, hidden when `hub.enabled` is false.
- **Analytics:** `Referral Prompt Shown {moment}` / `Referral Prompt Tapped {moment}`.

### 10.6 Activation (north-star input)
- **Hub** adds `activation: { activated, circleOf3, loggedDays3, reactionReceived, windowEndsAt }`. Each criterion is evaluated within 7 days of signup (circle membership is evaluated live).
  - `circleOf3`: in any active circle with ≥3 active members.
  - `loggedDays3`: ≥3 distinct activity days in the first 7 days.
  - `reactionReceived`: someone else reacted to one of the user's circle messages in the first 7 days.
- Clients fire `User Activated {}` once per user (persisted) the first time `activated` is true.
