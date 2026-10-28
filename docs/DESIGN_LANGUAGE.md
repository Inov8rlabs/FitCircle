# FitCircle design language

**Status:** draft, 2026-10-28. Applies to iOS, Android and web, and to any text the backend sends that the apps render.

The point: every screen should look like it came from one designer. Today we mix SF Symbols, Material icons, emoji used as icons (📸 💪 🏆 🌱 📊), several type scales, and 3D/glossy graphics next to flat ones. This doc is the single reference; the onboarding v3 prototype (https://claude.ai/artifact/G1Riib85KSza3rXeCzKhq5) follows it.

## 1. Icons

- **One icon family per platform, line style by default.**
  - iOS: **SF Symbols**, weight `.semibold` for tab bar and buttons, `.medium` in body rows. The filled variant is used only for selected state (tab bar) and status (checkmark circle).
  - Android: **Material Symbols Rounded**, weight 500, grade 0. Filled is used only for selected and status, as on iOS.
  - Web: Lucide (already the closest match to SF Symbols' stroke look).
- **Sizes:** 16 inline-with-text, 20 in rows and chips, 24 in buttons and tab bars, 28–32 in feature tiles. Never scale an icon to make it a hero; use an illustration instead (§4).
- **Containers:** a feature icon sits in a 44×44 rounded square (radius 12) on `surface-2`, tinted with the feature's accent at full strength. No drop shadows, no glows, no bevels.
- **Colour:** icons inherit text colour unless they mark a feature, in which case they use that feature's accent (§3).
- **Mapping for the emoji we use today** (the platform symbol to use instead):

| Was | Meaning | iOS (SF Symbol) | Android (Material Symbols) |
|---|---|---|---|
| 📸 📷 | photo / camera | `camera` | `photo_camera` |
| 💪 | strength / muscle | `dumbbell` | `fitness_center` |
| 🏆 | challenge / win | `trophy` | `trophy` |
| 🔥 | streak | `flame` | `local_fire_department` |
| 🎯 | goal | `target` | `target` |
| 📊 📈 | progress / data | `chart.bar` / `chart.line.uptrend.xyaxis` | `bar_chart` / `trending_up` |
| 🌱 🌿 🌳 ⭐ | level / beginner → expert | level dots or a 4-bar meter (see onboarding Activity screen), not plants | same |
| ❤️ 🤝 | community | `person.2` | `group` |
| ⚡ ⏱ ⏰ ⏳ | time / quick | `bolt` / `stopwatch` / `alarm` / `hourglass` | `bolt` / `timer` / `alarm` / `hourglass_empty` |
| 🏃 🚶 🧘 🚴 🏋️ | activity types | `figure.run` / `figure.walk` / `figure.mind.and.body` / `figure.outdoor.cycle` / `figure.strengthtraining.traditional` | `directions_run` / `directions_walk` / `self_improvement` / `directions_bike` / `fitness_center` |
| 💧 | water | `drop` | `water_drop` |
| ☕ | coffee / beverage | `cup.and.saucer` | `coffee` |
| 🍽 🍴 | meal / nutrition | `fork.knife` | `restaurant` |
| 👋 🎉 🥳 | greeting / celebration | Fitzy's animated wave; confetti animation | same |
| 👑 | Pro | crown badge (§5) | same |

## 2. Typography

- **iOS:** SF Pro via Dynamic Type text styles only (no fixed point sizes in new code):
  - `.largeTitle` (34, bold): screen titles on top-level tabs.
  - `.title` (28, bold): onboarding and sheet titles. The prototype's 28/34 heavy title maps here.
  - `.title3` (20, semibold): card titles.
  - `.headline` (17, semibold): list primary and buttons.
  - `.body` (17): body text.
  - `.subheadline` (15): secondary.
  - `.footnote` (13): legal and timestamps.
  - `.caption2` (11): tab labels.
  - Numbers in stats use `.monospacedDigit()` so they don't jitter.
- **Android:** the Material 3 type scale mapped 1:1:
  - `headlineMedium` ↔ `.title`
  - `titleMedium` ↔ `.headline`
  - `bodyLarge` ↔ `.body`
  - `bodyMedium` ↔ `.subheadline`
  - `labelSmall` ↔ `.caption2`
  - Font: the platform default (Roboto Flex). No third custom font.
- **Case:** sentence case everywhere ("Start my free trial", not "Start My Free Trial"). Small all-caps overlines (letter-spacing 1.4) only for section eyebrows like `FITCIRCLE PRO`.
- **Weights:** at most three per screen (regular, semibold, bold/heavy for titles).

## 3. Colour

Tokens. Hex values are for the dark theme, which is the only theme today.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#070A1A` | screen background |
| `surface-1` | `#11162A` | cards, rows |
| `surface-2` | `#1A2036` | icon containers, inputs |
| `border` | `rgba(255,255,255,0.07)` | card hairlines |
| `text-primary` | `#F5F7FF` | |
| `text-secondary` | `#AEB6CC` | passes 4.5:1 on `bg` and `surface-1` |
| `text-tertiary` | `#8E97AE` | timestamps, captions (≥4.5:1 on `bg`) |
| `brand-gradient` | `#7C3AED → #DB2777` | the ONE primary CTA per screen, Fitzy button |
| `accent-cyan` | `#22D3EE` | Fitzy, water |
| `accent-orange` | `#F97316` | calories, streak |
| `accent-violet` | `#A78BFA` | protein, selection |
| `accent-green` | `#22C55E` | success, steps |
| `accent-gold` | `#F59E0B → #EAB308` | Pro only |

- **Macro colours (proposal, Android W1, 2026-10-28; iOS to match):** calories `accent-orange`, protein `accent-violet`, **carbs `accent-green`**, **fat `accent-cyan`**. Every macro uses an existing accent, so nothing new enters the palette. Gold is ruled out because it is reserved for Pro. Pink is ruled out because it is half of the brand gradient. Green suits carbs (grains and produce); cyan's other uses (water, Fitzy) rarely sit in the same row as macros. Today the apps disagree: Android uses three different carbs/fat pairs, and the widgets use amber/blue.
- Selection: 2 pt `#8B5CF6` border plus `#1A1640` fill. No checkmark-only selection.
- The brand gradient is for primary CTAs and the Fitzy button only, not backgrounds, cards or text. Hero screens may use a radial glow of `#1B1747` behind Fitzy.

## 4. Imagery and illustration

- **Flat vector, two-tone, no 3D/gloss/emboss.** Shapes use the accent tokens at full or 85% opacity, on `surface` circles. The Pro crown, the plate on "Log your first meal" and the plan rings are the reference style.
- **Fitzy** is the only character. It is always the code-drawn ring avatar (cyan / violet / orange arcs, violet face), in three sizes: 32 (header), 40 (inline card), 160+ (hero). No other mascots or emoji faces.
- **Photos:** user meal photos only, with radius 16 and no filters. No stock photography.
- **Celebrations:** the confetti animation in brand accents plus a haptic. No trophy or party emoji.

## 5. Pro badge

- **Not subscribed:** a 44 pt circle on `surface-2` with a 1.5 pt gold hairline and a gold line-crown icon. A 14 pt `#EC4899` marker dot sits top-right while there is something new to see (it clears after the paywall is opened; it comes back for a new offer).
- **Subscribed:** a flat `accent-gold` gradient circle with a white line-crown. No glow. It sits left of the Fitzy button.

## 6. Emoji policy

- **Never** in system UI: not as icons, not in titles, buttons, empty states, onboarding, notifications or feed cards.
- **Allowed** in user-generated content (chat messages, names, notes) and in the reaction picker, where emoji *is* the content.
- **Fitzy replies:** chat reply text may use emoji where natural (one or two at most, never as bullet markers or in place of words). Suggestions, quick replies, action labels, onboarding answers, the daily focus, plans and push never do. Fitzy's personality is carried mostly by words and the avatar. (Owner decision, 2026-10-28.)
- **Push notifications and server-driven copy** (feed cards, campaigns, challenge templates, promos) follow the same rule. The backend owns those strings.
- **Logs** may keep emoji, since they're not user-visible, but new log lines shouldn't add them.

## 7. Components (reuse, don't restyle)

- **Primary button:** 56 pt, radius 16, brand gradient, `.headline` white.
- **Secondary:** a 44 pt text button in `text-secondary`. **Tertiary:** an outlined 50 pt `surface-1` button.
- **Option card:** min 76 pt, radius 18, a 44 pt icon container, title plus subtitle, and the selection treatment from §3.
- **Card:** `surface-1`, radius 20, 16 pt padding, `border` hairline, no shadow.
- **Onboarding header:** a 44 pt back chevron, a 6 pt progress bar with the gradient fill, and a 32 pt Fitzy on the right.


**2026-10-28 accessibility decision:** brand gradient deepened from #8B5CF6→#EC4899 to #7C3AED→#DB2777 so white 17pt semibold button labels pass WCAG AA (white on #7C3AED 5.7:1, on #DB2777 4.6:1). Selected-border colour is #8B5CF6, matching the prototype.
