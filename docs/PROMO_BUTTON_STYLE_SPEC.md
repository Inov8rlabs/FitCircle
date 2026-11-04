# Promo button styles + card surface (`promo_style@1`)

Status: **server + Admin Tools BUILT 2026-11-04** (branch `feat/promo-button-styles`, not merged). **Clients: iOS + Android 1.1.3** (this document is their spec).
Builds on: `PROMO_CARD_SPEC.md` (promo@1), `HOME_FEED_SPEC.md`, `PRO_LIFECYCLE_PROMPTS.md`, `DESIGN_LANGUAGE.md`.
Code: `apps/web/app/lib/promos/style.ts` (contract, presets, checks), `style-config.ts` (system promo looks), `services/promo-style-service.ts` + `promo-style-store.ts`, `pro-lifecycle/config.ts` (`StateConfig.style`).

## 0. Summary

The owner asked for server control over promo buttons: pick a gradient or a single colour, set the colour, and change it later without an app release. This adds an **additive, versioned look** to promo@1:

- `primary.style`: the hero button's fill (white / solid / gradient), label colour and an optional icon;
- `surface`: the card background, either `gradient` (today: `theme.background`) or `dark` (the Home card surface);
- `eyebrowColor`: an optional eyebrow colour (for example the brand violet on the dark surface).

These fields go **only** to clients that declare `promo_style@1`. Every shipped app (1.1.0–1.1.2) gets the payload it gets today, byte for byte. A route test pins this against a baseline generated from `origin/main` 950b9fe.

Admins choose a look per system promo (Admin Tools → Home feed → **Promo looks**) and per Pro lifecycle state (→ **Pro lifecycle**, "Card look"). They can A/B test up to 3 looks.

## 1. Why the shipped apps can't just use `theme.accent`

| | iOS 1.1.0–1.1.2 (`PromoCard.swift`) | Android 1.1.0–1.1.2 (`PromoCard.kt`) |
|---|---|---|
| Hero primary | `Capsule` filled **white** with `#111111` text (or `#111111` with white text when `foreground: dark`), min height 48 pt. **Ignores `theme.accent`.** | Material `Button`, `CircleShape`, min height 44 dp. Container = `theme.accent ?? (dark ? #0F172A : white)`. Label `#0F172A` when the container's luminance (no gamma) > 0.55, else white. |
| Banner CTA text | label + chevron in the text colour | label + chevron in **`accent`** |
| Badge | tone colour | **`accent`** fill, `onAccent` text |
| Banner / compact | no filled button | no filled button |

`accent` therefore restyles the Android hero button, banner CTA and badge, and changes nothing on iOS. That is a platform split we don't want. **Rule: the server never sends `theme.accent`.** None of the system promos or Pro lifecycle states set it, and the style feature does not use it. If someone adds `accent` to a creative later, Android 1.1.0–1.1.2 will recolour while iOS won't, so leave it unset. Clients from 1.1.3 on must ignore `theme.accent` when `primary.style` is present.

## 2. Capability declaration

A 1.1.3+ client adds **one** of these to `GET /api/mobile/home-feed` (both are accepted, and declaring both is harmless):

- the query parameter `features=promo_style@1`. This is preferred, because it follows the `cards=` / `actions=` pattern and shows up in request logs;
- the header `X-Client-Features: …,promo_style@1` (a bare `promo_style` means v1). Clients already send this header for `icon_keys`.

`features=` is parsed like `actions=`: a comma list of `name@version` tokens, case-insensitive, with junk ignored. `promo_style@0` and unknown features have no effect. A client that does not declare the feature never sees `style`, `surface` or `eyebrowColor`.

> Declare `promo_style@1` only once the client renders everything in §4. The feature is decided by capability, never by app version: a 1.1.3 build that forgets to declare it still gets the legacy payload, and a test covers this.

## 3. Wire contract (promo@1 `props`, promo_style@1 clients only)

```jsonc
{
  "promoId": "pro_expiring",
  "creativeId": "pro_expiring_hero_trial_usage_sb",   // `_s<variant>` only while an A/B test runs (§6)
  "layout": "hero",
  "theme": { "background": { "kind": "gradient", "colors": ["#1E1B4B", "#4338CA", "#7C3AED"] }, "foreground": "light" },
  "surface": "dark",                 // "gradient" | "dark"; always present for promo_style@1 clients
  "eyebrowColor": "#A78BFA",         // optional; absent = default eyebrow colour
  "eyebrow": "FitCircle Pro",
  "title": "Your free Pro week ends tomorrow",
  "primary": {
    "label": "Start 3-day free trial",
    "action": { "type": "paywall", "params": { "placement": "pro_expiring_card" } },
    "style": {                       // hero only; absent on banner / compact
      "kind": "gradient",            // "white" | "solid" | "gradient"
      "preset": "paywall",           // optional, informational (analytics / debugging)
      "gradient": { "colors": ["#7C3AED", "#DB2777"], "angle": 90 },   // gradient only: 2–3 stops, CSS degrees
      "text": "#FFFFFF",             // always concrete (the server resolves "auto")
      "icon": "crown"                // optional icon key (design/icons.json)
    }
  },
  "dismissible": true
}
```

| field | type | rules |
|---|---|---|
| `surface` | `"gradient"` \| `"dark"` | Always sent to capable clients. `dark` replaces `theme.background` (§4.1). |
| `eyebrowColor` | `#RRGGBB` | Optional. Hero and banner only (compact draws no eyebrow). |
| `primary.style.kind` | `white` \| `solid` \| `gradient` | `white`/`solid` carry `fill`, `gradient` carries `gradient`, never both. |
| `fill` | `#RRGGBB` | `white` is always `#FFFFFF`. |
| `gradient.colors` | 2–3 × `#RRGGBB` | Order = start → end. |
| `gradient.angle` | int 0–359 | CSS convention: 0 = to top, **90 = leading → trailing** (default; the paywall CTA), 180 = to bottom. |
| `text` | `#RRGGBB` | Label and icon colour. |
| `icon` | icon key | Leading icon. An unknown key → draw no icon. |
| `preset` | string | `white` \| `paywall` \| `brand_purple` today. **Draw from the fields, never from the preset name.** |

The server only sends `style` on the **hero** primary. Banner and compact cards have no filled button (their CTA is the whole card), so for them only `surface` and `eyebrowColor` apply. `secondary` never carries a style in v1.

### Presets (server-side)

| preset | resolves to | notes |
|---|---|---|
| `white` | `{kind: white, fill: #FFFFFF, text: #111111}` | Today's hero pill. Also the default when nothing is configured. |
| `paywall` | `{kind: gradient, gradient: {colors: [#7C3AED, #DB2777], angle: 90}, text: #FFFFFF}` | Exactly the paywall CTA: iOS `AppTheme.Gradients.brand`, Android `Gradients.brand`. White reaches 5.7:1 / 4.6:1 on its stops. |
| `brand_purple` | `{kind: solid, fill: #7C3AED, text: #FFFFFF}` | `brandFlat`, 5.7:1. |

Ready-made card looks in the editor: **Today** (gradient + white), **Paywall style** (`surface: dark`, `paywall` button, eyebrow `#A78BFA`) and **Dark + brand purple**.

## 4. Rendering rules (1.1.3)

### 4.1 Card surface

| `surface` | Background | Title | Body / eyebrow default | Close ✕ | Border |
|---|---|---|---|---|---|
| `gradient` (or absent) | `theme.background` exactly as today | `theme.foreground` rules as today | as today (85 % / 82 % alpha) | as today | none |
| `dark` | **`surface1` #11162A** (iOS `AppTheme.Colors.surface1`, Android `AppTheme surface1`) | `textPrimary` #F5F7FF | `textSecondary` #AEB6CC | `textSecondary` glyph on `Color.white.opacity(0.08)` | 1 px `border` (white 7 %), the same as other Home cards |

- On `dark`, ignore `theme.foreground` (text always uses the light tokens) and ignore `theme.background`. Keep the corner radius, padding and layout of today's card. Only the fill changes.
- The icon (hero glyph / banner tile) on `dark` uses `textPrimary`. The banner icon tile keeps its translucent white circle.
- `eyebrowColor`, when present, replaces the eyebrow colour on both surfaces (hero + banner). It is a plain colour, with no gradient text.
- Home is dark-only today, so `dark` means the same token in system light and dark mode. If a light theme ships, map `dark` to that theme's card token and re-check contrast with the server (§5), because the server validates against #11162A.

### 4.2 Hero primary button (`primary.style` present)

Geometry is **identical to today's hero pill** on each platform, so cards never change height:

| | iOS | Android |
|---|---|---|
| Shape | `Capsule()` | `CircleShape` |
| Height | `frame(maxWidth: .infinity).frame(minHeight: 48)` | `heightIn(min = 44.dp)`, `Modifier.weight(1f)` (shares the row with the secondary) |
| Label | `AppTheme.Typography.headline(weight: .semibold)`, colour `style.text` | `FontWeight.SemiBold`, 1 line, ellipsis, colour `style.text` |
| Icon | `Image(appIcon:)` 16 pt semibold, `style.text`, 6 pt before the label | `FcIcon` 18 dp, tint `style.text`, 6 dp before the label |
| Fill `white`/`solid` | `Capsule().fill(Color(hex: fill))` | `ButtonDefaults.buttonColors(containerColor = fill, contentColor = text)` |
| Fill `gradient` | `Capsule().fill(LinearGradient(colors:, startPoint:, endPoint:))` | `Modifier.background(Brush.linearGradient(colors, start, end), CircleShape)` on a `Button` with `containerColor = Transparent` |

**Gradient direction.** `angle` is CSS degrees. Convert it to a unit vector in a box of the button's size: `dx = sin(θ)`, `dy = −cos(θ)`. The gradient runs from `center − (dx, dy)·½` to `center + (dx, dy)·½` (in unit coordinates, y down).

- 90° → iOS `.leading` → `.trailing`, Android `Offset(0, h/2)` → `Offset(w, h/2)`.
- In **RTL**, mirror horizontally (use `.leading`/`.trailing` on iOS; on Android flip `dx` when `LayoutDirection.Rtl`). The paywall CTA behaves the same way.
- Stops are evenly spaced (0, 1 or 0, ½, 1).

**Pressed state.** Use the paywall's `PressStyle`: scale 0.97 + opacity 0.9, 0.12 s ease-out on iOS; on Android, Material ripple in `style.text` at 16 % over the fill. Never darken the gradient stops, which would break the validated contrast.

**Disabled / loading.** Promo buttons are never disabled by the server. If the client blocks a tap while the action runs (paywall loading), draw the fill at opacity 0.4, the same as `PaywallV2` `isEnabled = false`, and keep the label colour.

**Light/dark mode.** `style` colours are absolute. Draw them unchanged in both appearances.

**Secondary button.** Unchanged (text-only on iOS, outlined on Android). On `surface: dark` its colour is `textPrimary`, and on Android its outline is `textPrimary` at 50 %.

**Badge on Android.** With `primary.style` present, the badge uses its `tone` colour (like iOS) instead of `accent`. The banner CTA text uses the text colour (or `eyebrowColor` when present), not `accent`. This ends the Android-only `accent` behaviour for capable clients.

### 4.3 Banner / compact

No filled button: apply `surface` and `eyebrowColor` only. The banner's "label ›" row uses the text colour (`textPrimary` on dark).

## 5. Accessibility + validation (server, Admin Tools, and the client's safety net)

The server enforces these when a look is published (Admin Tools blocks publish) and **again on every send**. A variant that fails on a given creative is replaced by the default look for that request (`trace.promos[].styleRejected = "contrast"`); the promo is never dropped.

| check | threshold | level |
|---|---|---|
| hex format | `#RRGGBB` | error |
| label vs **every** fill stop | WCAG ≥ **4.5:1** (15–17 pt semibold is not "large text") | error |
| button vs card | for any (fill stop, card stop) pair with contrast < 1.5 **and** CIE76 ΔE < 35 → "blends in" (stops a purple button on a purple card) | error |
| button vs card | contrast < 1.5 but a clearly different hue (for example purple on teal) | warning (poor for colour-blind users) |
| eyebrow vs surface | ≥ 4.5:1 (dark: vs #11162A; gradient: vs the mid stop) | error |
| button style on banner / compact | not drawn | warning |

"Card stops" means #11162A on `dark`, or every `theme.background` stop on `gradient`. Examples: `paywall` on the Pro-ending gradient (#1E1B4B → #4338CA → #7C3AED) is blocked (ΔE 0 against #7C3AED), while on `dark` it passes (3.1 / 3.9:1, ΔE > 79).

**Client-side safety net** (lenient decode, same spirit as PROMO_CARD_SPEC §11):

- Decode `style` with a lenient decoder. If `kind` is unknown, a colour isn't `#RRGGBB`, `gradient` has fewer than 2 stops or `fill` is missing for its kind, **ignore `style` entirely** and draw today's white pill (iOS) / white Material button (Android, ignoring `accent`). Log `promo_style_invalid` with `promoId`/`creativeId`, once per creative per session.
- More than 3 stops → use the first 3. A missing or out-of-range `angle` → 90.
- An unknown `surface` value → `gradient`. An invalid `eyebrowColor` → default colour.
- A missing `text` → pick #FFFFFF or #111111 by best worst-case WCAG contrast over the stops (the server's `autoLabel`). Use real WCAG luminance with gamma, **not** the 1.1.0 Android `luminance()` approximation.
- Never re-validate contrast to *reject* a server style. The server owns that, so the two can't disagree.
- VoiceOver / TalkBack: the button keeps its label as the accessibility label. The icon is decorative (`accessibilityHidden` / `contentDescription = null`). Dynamic Type / font scale: the label wraps to 2 lines before truncating, and the minimum height grows with it.

## 6. A/B testing looks

- A look setting has 1–3 **variants** `{ id, weight, surface, button, eyebrowColor? }`. The bucket is `sha256("<promoKey>:style:" + userId) % 100` against the weights (`lib/experiments/bucket`). It is independent of the copy A/B (`pro_value`'s 3 creatives), so the two cross cleanly.
- While two or more variants have weight > 0, the **creative id gets `_s<variantId>`** (for example `pro_expiring_hero_trial_usage_sb`) for promo_style@1 clients only. `home_feed_events.creative_id`, `promo_user_state.creative_id` and `Promo Viewed/Tapped/Dismissed.creative` then split by look with no new analytics fields. Shipped clients keep the unsuffixed id, so filter the test to app version ≥ 1.1.3.
- The owner's first test: **A** = today (gradient card + white pill), **B** = Paywall style (dark card + paywall gradient + `#A78BFA` eyebrow), 50/50, on `pro_expiring` and `pro_expired`.
- Clients need no A/B logic: they draw what they receive. The iOS dismissal store keys `promoId|creativeId`, so a user's dismissal is per variant, and a user always stays in one variant.

## 7. Server + Admin Tools (built)

**Storage (no migration):**

- System promos: `feature_flags` row `promo_styles`, with metadata `{ version: 1, promos: { <first_meal|log_meal_now|pro_value|meet_fitzy>: StyleSetting } }`. A missing key keeps today's look.
- Pro lifecycle: `StateConfig.style?: StyleSetting` inside the existing `pro_lifecycle_prompts` row. It is absent by default, so the defaults and their content version `pl1-ee6710073d47a7a6` are unchanged.
- An invalid stored blob means no styles (today's look), with a warning in the log.
- The kill switch `PROMO_STYLES_ENABLED` is on by default. `false` gives every capable client the default look. Shipped clients are unaffected either way.
- The promo_styles read is cached per instance (30 s, stale ≤ 10 min) and only happens for capable clients, so shipped apps pay nothing.

**Admin endpoints** (Admin Tools proxy; same auth / audit as the Pro lifecycle editor):

- `GET /api/admin/home-feed/promo-styles`: config, version, presets, looks, promos + creatives (theme, layout), thresholds.
- `POST …/promo-styles/preview { config?, platform, version?=1.1.3, legacyVersion?=1.1.2 }`: per creative, the `legacy` props plus per variant the 1.1.3 props, its `issues` and `fellBack`; and `draft.{valid, issues, warnings, changes}`.
- `POST …/promo-styles/publish { baseVersion, config, summary, note? }`: compare-and-set (`409 STALE_DRAFT`), audit row `experiment_audit_log` key `config:promo_styles`.
- `GET …/promo-styles/changes`.
- The Pro lifecycle endpoints gain `states[].theme`, `styles` (presets / looks / thresholds), `draft.warnings`, and a `styleVariant` preview parameter that forces a variant. The admin "App version" switch previews `1.1.3` (styled) against `1.1.2` (today).

**Admin UI:**

- A button style picker: White / Solid / Gradient / presets, with colour pickers and hex inputs, up to 3 stops, and the angle.
- Label colour: Auto or custom. Optional icon.
- A surface picker and an eyebrow colour.
- Live contrast messages (the same maths as the server, vendored).
- An A/B variant editor.
- A phone preview with an **App version** switch: "1.1.3+ (new look)" against "Today's apps (≤ 1.1.2)", which shows the white pill on iOS and the accent/white Material button on Android.
- Publish goes through the confirm + audit dialog.

## 8. Snapshot / test requirements (1.1.3)

Each platform adds snapshot tests (iOS `swift-snapshot-testing`, Android Paparazzi / Roborazzi) at **375 pt / 360 dp width**, default and largest accessibility text size, LTR and RTL. The matrix:

1. hero × {`white` (no style field — legacy path), `white` preset, `paywall`, `brand_purple`, custom 3-stop gradient at 135°, `solid` light fill with dark label} × {`surface: gradient`, `surface: dark`} — plus `paywall` with a `crown` icon;
2. banner and compact × {`gradient`, `dark`} with and without `eyebrowColor`;
3. pressed state (paywall preset) and the 0.4-opacity loading state;
4. invalid payloads → identical to the legacy render: `kind: "neon"`, `fill: "purple"`, one gradient stop, `surface: "glass"`;
5. RTL paywall gradient: pink on the leading (right) edge mirrored correctly;
6. `theme.accent` present together with `primary.style` (Android): the style wins, and the badge and banner CTA don't use the accent.

Decoder unit tests use the server fixtures: copy `props` from `apps/web/app/api/mobile/home-feed/__tests__/promo-style-contract.test.ts` scenarios (`/admin preview` returns real 1.1.3 props too). Also add a request test asserting `features=promo_style@1` is on the feed request.

## 9. iOS fix shipping with 1.1.3: report the paywall placement correctly

Shipped iOS maps a promo `paywall` action's placement through `PaywallContext(placement:)` (`Core/Models/Subscription.swift`). Any placement it doesn't know becomes `.dashboardCard`, so `Paywall Viewed.source = "pro_card"`. The Pro lifecycle cards send `pro_expiring_card`, `pro_expired_card` and `trial_expiring_card`, and **iOS 1.1.0–1.1.2 reports all of them as `pro_card`**. Android already passes unknown placements through: `PaywallContext.PROMO`, with analytics source = the placement.

1.1.3 must:

- add a generic case, for example `case promo(placement: String)`. Unknown placements that match `^[a-z][a-z0-9_]{0,39}$` map to it, and anything else maps to `.dashboardCard`;
- report `analyticsSource = placement` for that case (`AnalyticsMapping.swift`), so `pro_expiring_card` / `pro_expired_card` / `trial_expiring_card` and future placements arrive unchanged without another release;
- copy and layout: the `.dashboardCard` paywall copy (PaywallV2Copy), not onboarding / hard;
- keep the known mappings (`first_meal_aha`, `feed_pro_value`, `ai_limit`, `settings`, `fitzy`);
- test it: `PaywallContext(placement: "pro_expired_card").analyticsSource == "pro_expired_card"`, `"Bad Placement!"` → `pro_card`, and the known placements unchanged.

Until 1.1.3 is out, the iOS split of lifecycle conversions comes from `home_feed_events` (card_id `promo:pro_expiring` / `promo:pro_expired`), not from `Paywall Viewed.source`.

## 10. Rollout

1. Merge + deploy BE (`feat/promo-button-styles`) and Admin Tools (same branch). This is safe at any time: nothing changes for any shipped app, and the published look settings stay empty until someone edits them.
2. iOS + Android 1.1.3: render §4, declare `promo_style@1`, the decoder fallbacks and snapshots in §8, and the iOS placement fix in §9.
3. Once 1.1.3 has meaningful adoption, publish the A/B on `pro_expiring` / `pro_expired` (A today / B paywall style). Read results by `creative_id` suffix, filtered to app version ≥ 1.1.3.
4. Rollback: delete the variant in Admin Tools (publish), or set `PROMO_STYLES_ENABLED=false`.
