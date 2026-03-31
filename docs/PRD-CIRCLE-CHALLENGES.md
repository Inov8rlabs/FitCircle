# Circle Challenges PRD
**Version:** 1.0
**Date:** 2026-03-30
**Author:** FitCircle Product Team
**Status:** Ready for Engineering Review

---

## Executive Summary

Circle Challenges transforms FitCircles from passive accountability groups into active, high-energy competition arenas. Members can create structured fitness challenges — sprint or endurance, strength or cardio, individual or group — and compete against each other through a real-time leaderboard scoped entirely to their circle.

This feature is the highest-leverage engagement driver available to FitCircle today. It gives members a reason to open the app multiple times per day, creates natural social pressure that increases retention, and generates the kind of shareable "I won" moments that drive virality. Every challenge is a fresh hook for re-engagement, and every leaderboard ranking is a reason to log one more activity.

**Expected Impact (90 days post-launch):**
- DAU/MAU ratio: +8-12 percentage points
- D30 retention: +6-9 percentage points
- Sessions per user per day: +1.4 sessions
- Social actions (high-fives, comments): +60%
- Challenge completion rate target: 68%

---

## Table of Contents

1. Problem Statement
2. Competitive Research and Best Practices
3. Target Users and Jobs-to-be-Done
4. Feature Overview
5. Challenge Templates (20 templates)
6. User Stories
7. Detailed Feature Requirements
8. Data Model
9. Leaderboard Ranking Logic
10. Activity Logging UX
11. Gamification System
12. Analytics and Instrumentation
13. Success Metrics
14. Edge Cases and Considerations
15. MVP vs. Future Phases
16. Technical Considerations
17. Risks and Mitigations

---

## 1. Problem Statement

### What is Happening Today

FitCircles exist as shared spaces where members track individual goals (weight loss, steps, workouts) and see each other's progress percentages on a leaderboard. This works for long-horizon goals — a 90-day weight loss challenge is meaningful — but it creates a problem: the leaderboard barely moves day-to-day, so there is little reason to check it more than once a week.

The result is a predictable engagement curve: high excitement at circle creation, steady drop-off through week two, and by week four the majority of members are passively drifting. The app has a check-in habit, but it does not have a challenge habit.

### The Specific Gap

There is no mechanism within a FitCircle for members to compete on a discrete, time-boxed activity. If five friends want to collectively complete 500 pushups this week and see who contributed most, there is no way to do that today. They would have to track it in a group chat. That is the gap Circle Challenges fills.

### Why Now

The engagement system (streaks, milestones, high-fives) is live. The leaderboard infrastructure exists. The check-in data model is proven. Circle Challenges is the natural next layer — it converts the infrastructure already built into a daily-use product loop.

### Who Is Affected

All three primary personas feel this gap:

- **Competitive Casey** wants short, intense sprints where ranking matters every day, not just at the 30-day mark.
- **Social Sarah** wants shared goals her group rallies around together — a challenge everyone is on, not just adjacent to.
- **Motivated Mike** wants structured programs that give him clear daily targets, not open-ended goals that require self-direction.

---

## 2. Competitive Research and Best Practices

### How Leading Fitness Apps Handle Challenges

#### Strava
**What works:** Segment challenges (e.g., "Climb 5,000m in May") give users a shared bar to hit. The monthly challenge badge drives significant activity spikes at end-of-month as users push to finish. Club challenges let friend groups compete privately on total volume. Clear progress bars and public leaderboards within clubs create daily check-in behavior.

**What doesn't:** Challenges are athlete-centric (running, cycling) and assume wearable integration. There is no lightweight challenge for non-athletes. Template variety is thin. No in-challenge social layer — no way to trash talk, cheer, or comment mid-challenge.

**Key insight:** Scoped leaderboards (club-only) outperform global leaderboards for retention because ranking feels achievable.

#### Nike Run Club
**What works:** Guided challenges with coach voice-overs and embedded workout plans give users a sense of being coached through the challenge, not just scored on it. Milestones (25%, 50%, 75%, 100% complete) trigger push notifications and celebration moments. Friend challenges via NRC app allow 1:1 or small-group competition.

**What doesn't:** Entirely running-focused. Challenge creation is not user-generated — only Nike-authored challenges exist. No template customization.

**Key insight:** Milestone celebrations (not just final completion) dramatically increase challenge persistence. Users who hit the 50% milestone complete at 2.4x the rate of those who don't.

#### Fitbit
**What works:** Weekend Warrior, Workweek Hustle, and Daily Showdown are the three best-known challenge formats in consumer fitness. They are simple, familiar, and repeatable. The 7-day step challenge with friend groups has become a genuine habit loop for millions of users. Auto-invite (suggest friends from contacts) dramatically reduces friction to start a challenge.

**What doesn't:** Only steps. The product has not expanded challenge types in years. No custom challenges. The social layer is minimal — reactions are limited.

**Key insight:** Repeatable, low-setup challenges (auto-restart, same friends, same format) have 3x higher long-term participation rates than one-off challenges.

#### Apple Fitness+
**What works:** Activity Sharing allows friends to see each other's rings and compete on daily close rates. The Move ring competition is elegantly simple — one number, one goal, ranked clearly. Sharing a ring close is a native shareability moment.

**What doesn't:** Requires Apple Watch. No custom challenge creation. Competition is always on the same metric (Move calories) regardless of user goal.

**Key insight:** Visual progress metaphors (rings, bars, arcs) increase perceived progress even when absolute progress is small. The ring-closing animation is a proven dopamine trigger.

#### Peloton
**What works:** The Homecoming challenge and monthly challenges create community events with shared identity. The output leaderboard during live classes is the single most-discussed feature in Peloton reviews. High-five mechanics during classes are lightweight and feel spontaneous.

**What doesn't:** Hardware-gated. No async challenges — participation requires scheduled class attendance. No custom or user-generated challenges.

**Key insight:** Real-time or near-real-time rankings (within a live class) drive dramatically higher effort output than retrospective rankings. Where real-time isn't possible, frequent leaderboard refreshes (hourly vs. daily) improve engagement.

#### Whoop
**What works:** Group challenges around strain scores allow teams to compete on effort relative to their own baseline, not absolute output. This solves the fairness problem inherent in step-count challenges (fit people dominate).

**Key insight:** Relative/normalized metrics (% of personal best, effort vs. baseline) level the playing field and increase participation from beginners who would otherwise disengage when outmatched by advanced users.

### What the Research Says About Challenge Completion

Synthesizing published research on fitness behavior change and app retention data:

1. **Social commitment > personal commitment.** Challenges with 3+ active participants complete at 2.1x the rate of solo challenges. The key mechanism is anticipated social observation — knowing others will see your rank.

2. **Duration sweet spot is 7-21 days.** Challenges shorter than 7 days feel trivial and don't build habit. Challenges longer than 30 days suffer from middle-distance fatigue — completion rates drop sharply after day 21 without milestone celebrations.

3. **Daily logging frequency is a leading indicator of completion.** Users who log on 5 of the first 7 days complete at 74%. Users who log on 3 of the first 7 days complete at 31%. This makes early logging behavior the most important intervention point.

4. **Leaderboard position relative to peers matters more than absolute rank.** Being ranked 3rd out of 6 is more motivating than being ranked 300th out of 10,000, even if the latter represents higher absolute performance. Scoped leaderboards are essential.

5. **Notification timing matters.** Push notifications sent when a user drops in rank outperform scheduled daily digests by 3.8x on open rate. "Casey just passed you — you're now 4th" is the highest-value notification trigger in competitive fitness.

6. **Photo/proof logging increases completion by 18%.** Even optional photo logging (not required for validation) correlates with higher completion because it increases accountability perception.

7. **Streaks are powerful up to 14 days, then plateau.** Streak anxiety (fear of breaking a streak) is the strongest short-term motivator but burns out as a mechanism. Pair streaks with other reward layers.

### Gamification Best Practices

Research from Octalysis, Nir Eyal's Hook Model, and fitness-specific behavioral studies converges on a set of proven mechanics:

- **Variable reward schedules** (not fixed daily XP, but milestone-triggered bonuses) outperform predictable reward schedules for long-term engagement.
- **Loss aversion** is 2x more motivating than equivalent gain. Streaks, rank-drop notifications, and limited-time bonuses leverage loss aversion effectively.
- **Progress visualization** with visual completeness cues (a ring that is 80% closed, a bar nearly full) triggers completion behavior more powerfully than numeric progress alone.
- **Social proof** ("3 of your 5 circle members have logged today") is more compelling than absolute reminders ("Log your activity").
- **Meaningful choice** in challenge selection increases perceived ownership and completion. Users who choose their challenge complete at 1.6x the rate of users assigned a challenge.

---

## 3. Target Users and Jobs-to-be-Done

### Primary JTBD: "Help me stay accountable to a specific fitness habit"

When a user creates or joins a Circle Challenge, the functional job is to establish an external accountability structure around a specific behavior (doing 50 pushups/day, walking 10,000 steps/day) that they struggle to sustain alone. The social job is to compete in a context where the bar feels achievable and the peers are known quantities. The emotional job is to feel like a person who follows through.

### User Segment Fit

| Persona | Primary Use Case | Challenge Format Preference | Logging Behavior |
|---------|-----------------|----------------------------|-----------------|
| Competitive Casey | Rank-climbing sprint | 7-14 day, high-frequency logging | Multiple times/day, max output |
| Social Sarah | Group collective goal | 21-30 day, community feel | Once/day, social engagement |
| Motivated Mike | Structured daily habit | 30 day, clear target | Morning log, consistency over intensity |
| Fitness Fanatic Fiona | Elite benchmark | 7 day, max difficulty | Multiple logs, PRs |
| Budget-Conscious Blake | Free, low-effort entry | 14 day, step-count | Daily passive (wearable sync) |

### Anti-Use Cases (Not Designing For)

- Corporate wellness teams coordinating 50+ person challenges (future phase)
- Challenges requiring external verification (race times, gym attendance) — too much friction for MVP
- Monetary prize challenges — regulatory complexity, not in MVP scope

---

## 4. Feature Overview

Circle Challenges introduces a self-contained challenge layer inside every FitCircle. A challenge is a time-boxed, metric-specific competition where circle members log activity repeatedly and compete on a real-time leaderboard. Challenges are independent from the circle's main goal — a circle running a 90-day weight loss competition can simultaneously run a "1,000 Squats This Week" challenge.

### Core Components

1. **Challenge Creation** — Any circle member can create a challenge from a template or from scratch, set a duration, a goal, and invite other members.
2. **Challenge Templates** — 20 pre-built challenge templates across 5 categories, designed to be immediately understandable and achievable.
3. **Activity Logging** — A dedicated quick-log sheet for recording activity toward the challenge, supporting multiple logs per day.
4. **Circle Leaderboard** — A real-time, circle-scoped leaderboard showing cumulative progress, ranking, and gaps between participants.
5. **Gamification** — Milestone celebrations, streaks, badges, and XP that reward consistent logging.
6. **Engagement Mechanics** — Push notifications for rank changes, high-fives on logs, and challenge completion celebrations.

### What Circle Challenges Is Not (MVP)

- Not a replacement for the circle's primary goal leaderboard
- Not monetized (no prize pools or entry fees in MVP)
- Not visible outside the circle (no public challenge discovery)
- Not connected to wearable devices in MVP (manual logging only)

---

## 5. Challenge Templates

Templates are pre-configured challenges that reduce the cognitive load of challenge creation. Each template has a name, description, category, default goal, unit, recommended duration, difficulty level, and a suggested icon. Users can edit any parameter after selecting a template.

### Category 1: Strength

#### Template 1: Pushup Push
- **Description:** Build upper body strength with daily pushups. Log every set throughout the day — they add up fast.
- **Default Goal:** 500 pushups total over the challenge
- **Unit:** Reps
- **Recommended Duration:** 7 days
- **Difficulty:** Beginner-Intermediate
- **Logging Prompt:** "How many pushups did you do?"
- **Why It Works:** Simple, requires no equipment, can be done in any increment. A set of 20 pushups feels trivial in isolation but collectively produces satisfying totals.

#### Template 2: Squat Squad
- **Description:** Leg day, every day. Log your squats anytime — morning, lunch, watching TV. Whoever squats the most wins.
- **Default Goal:** 1,000 squats total over the challenge
- **Unit:** Reps
- **Recommended Duration:** 10 days
- **Difficulty:** Beginner-Intermediate
- **Logging Prompt:** "How many squats did you crush?"
- **Why It Works:** Squats are the canonical "I can do fitness anywhere" move. Multiple daily logs are natural.

#### Template 3: Plank Challenge
- **Description:** Core strength through consistency. Hold your plank, log your time. Longest cumulative time wins.
- **Default Goal:** 60 minutes total plank time over the challenge
- **Unit:** Minutes (logged in seconds, displayed in minutes)
- **Recommended Duration:** 14 days
- **Difficulty:** Intermediate
- **Logging Prompt:** "How long did you hold? (minutes and seconds)"
- **Why It Works:** Timer-based logging feels precise and gamified. Plank PRs are naturally shareable.

#### Template 4: Burpee Blitz
- **Description:** The exercise everyone loves to hate. Log your burpees throughout the day. Warning: this gets competitive fast.
- **Default Goal:** 300 burpees total over the challenge
- **Unit:** Reps
- **Recommended Duration:** 7 days
- **Difficulty:** Intermediate-Advanced
- **Logging Prompt:** "How many burpees did you survive?"
- **Why It Works:** Burpees have strong social resonance — everyone knows they are hard. Shared suffering creates community.

#### Template 5: Pull-Up Progress
- **Description:** Log every pull-up you do. Whether you're doing 1 at a time or sets of 10, it all counts. Highest total wins.
- **Default Goal:** 200 pull-ups total over the challenge
- **Unit:** Reps
- **Recommended Duration:** 14 days
- **Difficulty:** Advanced
- **Logging Prompt:** "How many pull-ups did you do?"
- **Why It Works:** Pull-ups are a status exercise. High totals signal elite fitness and drive competition.

### Category 2: Cardio

#### Template 6: Step Sprint
- **Description:** Classic step competition, FitCircle style. Log your steps throughout the day. Whoever walks the most wins.
- **Default Goal:** 70,000 steps total over the challenge (10K/day average)
- **Unit:** Steps
- **Recommended Duration:** 7 days
- **Difficulty:** Beginner
- **Logging Prompt:** "How many steps did you log today?"
- **Why It Works:** Steps are universally understood, require no equipment, and the Fitbit-style step challenge is the most-proven format in consumer fitness.

#### Template 7: Miles on the Board
- **Description:** Run, walk, bike — all mileage counts. Log every mile you cover over the challenge duration.
- **Default Goal:** 26.2 miles over the challenge (marathon distance)
- **Unit:** Miles (or km with unit toggle)
- **Recommended Duration:** 14 days
- **Difficulty:** Intermediate
- **Logging Prompt:** "How many miles did you cover?"
- **Why It Works:** The marathon distance as a collective target is instantly meaningful. Crossing 26.2 is a celebration moment even when split across two weeks.

#### Template 8: Calorie Burn Battle
- **Description:** Log the calories you burn in workouts. Any workout counts — runs, HIIT, lifting, yoga. Highest total burns win.
- **Default Goal:** 5,000 calories burned over the challenge
- **Unit:** Calories
- **Recommended Duration:** 14 days
- **Difficulty:** Intermediate
- **Logging Prompt:** "How many calories did you burn this workout?"
- **Why It Works:** Calories are the universal fitness metric. Works across any workout type, making it inclusive.

#### Template 9: Active Minutes
- **Description:** Every minute of intentional movement counts. Walks, stretches, gym sessions — log it all.
- **Default Goal:** 300 active minutes over the challenge
- **Unit:** Minutes
- **Recommended Duration:** 14 days
- **Difficulty:** Beginner
- **Logging Prompt:** "How many minutes were you active?"
- **Why It Works:** Highly inclusive — intentional walking counts as much as a gym session. Ideal for beginners or injury-recovery users.

#### Template 10: Cycling Century
- **Description:** Whether on a real bike or a Peloton, every mile counts. Collectively or competitively, ride 100 miles.
- **Default Goal:** 100 miles over the challenge
- **Unit:** Miles
- **Recommended Duration:** 21 days
- **Difficulty:** Intermediate
- **Logging Prompt:** "How many miles did you ride?"
- **Why It Works:** Century (100-mile) is a meaningful cycling milestone. Naming the challenge after it creates aspiration.

### Category 3: Flexibility and Mobility

#### Template 11: Stretch It Out
- **Description:** Flexibility matters. Log your stretching sessions — anything over 5 minutes counts. Consistency beats intensity here.
- **Default Goal:** 30 stretching sessions over the challenge
- **Unit:** Sessions
- **Recommended Duration:** 30 days
- **Difficulty:** Beginner
- **Logging Prompt:** "Did you stretch today? How many sessions?"
- **Why It Works:** Low barrier, high frequency. Encourages a habit that most people know they should build but don't.

#### Template 12: Yoga Flow
- **Description:** Log every yoga practice — from a 10-minute morning flow to a 60-minute class. Minutes of yoga practiced over the challenge.
- **Default Goal:** 300 minutes of yoga over the challenge
- **Unit:** Minutes
- **Recommended Duration:** 30 days
- **Difficulty:** Beginner-Intermediate
- **Logging Prompt:** "How many minutes did you flow?"
- **Why It Works:** Yoga is the fastest-growing fitness category. Yoga practitioners are highly engaged social sharers.

#### Template 13: Foam Roller Recovery
- **Description:** Recover like a pro. Log every foam rolling or mobility session. Often ignored, always effective.
- **Default Goal:** 20 recovery sessions over the challenge
- **Unit:** Sessions
- **Recommended Duration:** 21 days
- **Difficulty:** Beginner
- **Logging Prompt:** "Did you roll out today?"
- **Why It Works:** Recovery challenges are counterintuitive (making rest competitive) and generate conversation. Differentiates FitCircle from pure performance apps.

### Category 4: Wellness

#### Template 14: Hydration Nation
- **Description:** Log your water intake daily. 8 glasses (64 oz) is the baseline. Log every glass, every bottle. Most hydrated wins.
- **Default Goal:** 56 glasses (8 glasses x 7 days) over the challenge
- **Unit:** Glasses (8 oz)
- **Recommended Duration:** 7 days
- **Difficulty:** Beginner
- **Logging Prompt:** "How many glasses of water today?"
- **Why It Works:** Hydration is universally agreed upon as important and universally neglected. Low-friction daily logging. Works for all fitness levels.

#### Template 15: Sleep Streak
- **Description:** Log 7+ hours of sleep each night. Every night you hit the target counts. Streak of consecutive nights wins.
- **Default Goal:** 14 nights of 7+ hours sleep
- **Unit:** Qualifying nights
- **Recommended Duration:** 21 days
- **Difficulty:** Beginner
- **Logging Prompt:** "How many hours did you sleep last night?"
- **Special Logic:** Only logs of 7+ hours count toward the goal. Users below 7 hours log but do not accumulate.
- **Why It Works:** Sleep is the most impactful health behavior with the worst compliance rates. Making it competitive creates accountability. Streak mechanic is naturally suited to binary (you hit it or you didn't).

#### Template 16: Mindfulness Minutes
- **Description:** Meditate, journal, breathe — log your mindfulness practice daily. Most mindful member over the challenge wins.
- **Default Goal:** 150 minutes of mindfulness over the challenge
- **Unit:** Minutes
- **Recommended Duration:** 21 days
- **Difficulty:** Beginner
- **Logging Prompt:** "How many minutes did you practice mindfulness?"
- **Why It Works:** Wellness challenges attract Social Sarah and Motivated Mike who want holistic health, not just performance. Differentiates from cardio/strength-only apps.

#### Template 17: Veggie Wins
- **Description:** Log servings of vegetables each day. Each serving is a point. Most vegetables eaten over the challenge wins.
- **Default Goal:** 70 servings over the challenge (10 servings/day)
- **Unit:** Servings
- **Recommended Duration:** 7 days
- **Difficulty:** Beginner
- **Logging Prompt:** "How many veggie servings did you eat today?"
- **Why It Works:** Nutrition challenges complement fitness tracking. High logging frequency (3+ meals/day) drives DAU. Lighthearted and approachable.

### Category 5: Custom and Milestone

#### Template 18: Workout Streak
- **Description:** Log a workout every single day. Any workout counts — 10-minute walk, full gym session, yoga class. Longest streak wins.
- **Default Goal:** Complete a workout every day for the duration
- **Unit:** Qualifying days
- **Recommended Duration:** 14 days
- **Difficulty:** Intermediate
- **Logging Prompt:** "Did you work out today?"
- **Special Logic:** Streak breaks if no log is submitted for a day. Leaderboard ranks by current streak, then by longest streak, then by total days.
- **Why It Works:** Binary daily challenge is the simplest possible format. Maximum clarity, minimum friction.

#### Template 19: Personal Record Hunt
- **Description:** Set a goal. Beat it. Log your best performance for any exercise you choose. Track PRs over the challenge.
- **Default Goal:** Set by the user at challenge join (custom PR target)
- **Unit:** User-defined
- **Recommended Duration:** 21 days
- **Difficulty:** Variable
- **Logging Prompt:** "What was your best today? (Your chosen metric)"
- **Special Logic:** Each user sets their own starting benchmark and target when joining. Leaderboard shows improvement percentage vs. personal starting point.
- **Why It Works:** Normalized improvement (% gain from baseline) levels the playing field between beginners and advanced users. Competitive Casey and Fitness Fanatic Fiona both see compelling rank potential.

#### Template 20: Custom Challenge
- **Description:** Design your own challenge. Set any metric, any unit, any goal. Your circle, your rules.
- **Default Goal:** User-defined
- **Unit:** User-defined (free text, max 20 chars)
- **Recommended Duration:** User-defined (7-90 days)
- **Difficulty:** Variable
- **Logging Prompt:** User-defined (free text prompt shown at log time, max 60 chars)
- **Why It Works:** Power users and group organizers need creative control. Custom challenges also generate qualitative data on what metrics users care about beyond the templates.

---

## 6. User Stories

### Challenge Creation

**US-01 (P0):** As a circle member, I want to create a challenge from a template so that I can quickly launch a structured competition without building it from scratch.

**US-02 (P0):** As a circle member, I want to set a custom challenge name, goal, and duration so that I can tailor the challenge to my group's interests.

**US-03 (P0):** As a challenge creator, I want to invite specific circle members to the challenge so that I can control who participates (not all circle members are required to join every challenge).

**US-04 (P1):** As a challenge creator, I want to set the challenge as "open to all circle members" so that anyone in the circle can join without an explicit invitation.

**US-05 (P1):** As a circle member, I want to browse active challenges in my circle and join any open challenge so that I can participate at my own discretion.

### Activity Logging

**US-06 (P0):** As a challenge participant, I want to log my activity toward the challenge multiple times per day so that I can capture incremental effort (e.g., 30 pushups in the morning, 40 at lunch, 30 at night).

**US-07 (P0):** As a challenge participant, I want to see my own cumulative total for today and for the full challenge so that I know exactly where I stand.

**US-08 (P0):** As a challenge participant, I want to add an optional note to my log entry so that I can add context ("did these at the gym after back squats").

**US-09 (P1):** As a challenge participant, I want to log activity from the challenge's leaderboard view so that I don't have to navigate away to log.

**US-10 (P1):** As a challenge participant, I want to edit or delete a log entry from today so that I can correct mistakes.

**US-11 (P2):** As a challenge participant, I want to attach a photo to a log entry so that I can share proof and add social richness.

### Leaderboard

**US-12 (P0):** As a challenge participant, I want to see a real-time leaderboard showing all participants ranked by cumulative total so that I know exactly where I stand relative to my peers.

**US-13 (P0):** As a challenge participant, I want to see the gap between my current total and the person ranked above me so that I know exactly how much I need to log to move up.

**US-14 (P0):** As a challenge participant, I want to see today's contribution alongside the all-time total for each participant so that I can see who is logging consistently today vs. who is coasting on an early lead.

**US-15 (P1):** As a challenge participant, I want to receive a push notification when someone overtakes my rank so that I am motivated to log more activity.

**US-16 (P1):** As a challenge participant, I want to see a streak indicator for each participant showing their current daily logging streak so that I can identify who is most consistent.

### Engagement and Social

**US-17 (P0):** As a challenge participant, I want to high-five a teammate's log entry so that I can encourage them and feel socially connected.

**US-18 (P1):** As a challenge participant, I want to receive a push notification when I reach 25%, 50%, 75%, and 100% of the challenge goal so that milestones feel like moments.

**US-19 (P1):** As a challenge creator, I want to receive a push notification when the challenge completes and see a winner summary so that the ending feels like an event.

**US-20 (P2):** As a challenge participant, I want to share my challenge result (rank, total, completion percentage) to social media so that I can celebrate publicly.

### Discovery and Management

**US-21 (P0):** As a circle member, I want to see all active challenges in my circle on the circle dashboard so that I always know what is running.

**US-22 (P1):** As a circle member, I want to see past completed challenges and their final results so that history is preserved.

**US-23 (P1):** As a challenge creator, I want to cancel a challenge that has not started yet so that I can correct mistakes before the challenge goes live.

**US-24 (P2):** As a circle member, I want to nominate a challenge template for my circle so that the creator can see what the group wants to run next.

---

## 7. Detailed Feature Requirements

### 7.1 Challenge Creation Flow

#### Creation Entry Points
- "Create Challenge" button on the circle dashboard (visible to all members, not just admins)
- "Start a Challenge" CTA within an empty challenge state
- Long-press or context menu on a template in the template browser

#### Creation Wizard — Step 1: Choose a Template
- Display the 20 templates in a scrollable grid, organized by category tabs: All, Strength, Cardio, Flexibility, Wellness, Custom
- Each template card shows: name, category icon, default duration badge, difficulty label
- Tapping a template shows a preview sheet with full description, default goal, and a "Use This Template" CTA
- "Start from scratch" option at the bottom routes to a fully blank configuration (same as Custom template)

#### Creation Wizard — Step 2: Configure the Challenge
- **Challenge Name** (pre-filled from template, editable): Required, 3-50 characters
- **Description** (pre-filled from template, editable): Optional, max 200 characters
- **Goal Amount**: Numeric input, pre-filled from template default, editable
- **Unit**: Pre-filled from template, editable (free text, max 20 chars) — but for standard templates, show a read-only lock icon since changing units would break the leaderboard logic
- **Start Date**: Date picker. Default: tomorrow. Min: today. Max: 30 days from today.
- **End Date**: Date picker. Default: start date + template default duration. Min: start date + 3 days. Max: start date + 90 days.
- **Duration display**: Auto-calculated "X-day challenge" shown in real time below the date pickers

#### Creation Wizard — Step 3: Invite Members
- List of all active circle members with a checkbox to invite each one
- "Invite all circle members" toggle at the top (default: ON for open challenges)
- If "Invite all" is off, the challenge is invitation-only and only selected members can see and join it
- Creator is automatically added as a participant
- Invited members receive a push notification and an in-app banner

#### Creation Wizard — Step 4: Review and Launch
- Summary card showing: name, goal, duration, template category, invited count
- "Launch Challenge" primary CTA
- Challenges with a future start date show "Scheduled — launches [date]"
- Challenges starting today show "Live immediately on launch"

#### Post-Creation
- Creator sees the challenge detail screen immediately
- All invited members receive a notification: "[Name] started '[Challenge Name]' in [Circle Name] — join now!"
- Challenge appears in the circle's active challenges list

### 7.2 Activity Logging

#### Log Entry Points
- "Log Activity" floating action button on the challenge detail screen
- Quick-log entry from the leaderboard row (tap own row to expand a mini-log form)
- From the circle dashboard, a challenge card with an active logging CTA

#### Log Entry Sheet (Bottom Sheet)
The log sheet slides up from the bottom with:
1. **Challenge name and icon** at the top for orientation
2. **Today's running total** displayed prominently: "You've logged 120 reps today"
3. **Input field**: Large numeric input, keyboard auto-shows with numeric keypad
4. **Unit label**: Shows the challenge unit ("reps", "steps", "minutes", etc.)
5. **Optional note field**: "Add a note (optional)" — single line, max 80 chars
6. **Log button**: Primary CTA, disabled until a valid number > 0 is entered
7. **Cancel**: Dismisses without logging

#### Log Entry Validation
- Minimum value: 1 (or 0.1 for decimal-unit challenges like miles)
- Maximum single log: 10,000 (to prevent accidental extra-digit entries)
- Maximum logs per day per challenge: 20 (prevents abuse)
- If max logs reached, the log button is hidden and replaced with: "Max logs for today reached — see you tomorrow!"

#### Post-Log Feedback (Micro-interaction)
- On tap of "Log", the input animates: number increments visually into the running total
- A brief celebration animation (confetti burst in brand colors) for logs that:
  - Push the user past a milestone (25%, 50%, 75%, 100% of total goal)
  - Push the user into a new leaderboard rank position
- Running total updates in real time
- High-five prompt: "Give [Name] a high-five?" if another participant logged in the last 5 minutes

#### Editing Logs
- From the activity history tab on the challenge detail screen, the current day's logs are editable
- Tap a log to open a delete confirmation or an edit sheet
- Only today's logs are editable; past-day logs are locked (prevents retroactive manipulation)
- Deleted logs immediately recalculate cumulative total and leaderboard rank

### 7.3 Leaderboard

#### Display Layout
Each leaderboard row shows:
- **Rank number**: 1, 2, 3... with gold/silver/bronze medals for top 3
- **Avatar and display name**
- **Cumulative total**: Bold, primary metric ("1,240 reps")
- **Today's total**: Secondary, smaller ("120 today")
- **Progress bar**: Thin arc or bar showing % of total challenge goal completed
- **Streak indicator**: Flame icon with streak count if participant has logged on consecutive days
- **Gap to next rank**: Shown only on the user's own row — "+80 reps to pass [Name]"

#### Ranking Logic (see Section 9 for full detail)
- Primary sort: Cumulative total (descending)
- Tiebreaker 1: Today's logged total (descending) — more recent effort wins ties
- Tiebreaker 2: Current streak length (descending)
- Tiebreaker 3: Earliest join time (ascending) — loyal early joiners win final ties

#### Leaderboard Refresh
- Refreshes in real time via Supabase Realtime channel subscribed per active challenge
- If real-time connection drops, falls back to polling every 60 seconds
- "Last updated [time]" indicator in small text below the leaderboard header
- Pull-to-refresh gesture always available

#### Leaderboard States
- **Pre-start**: Shows invited members, "Challenge starts in X days" header, no logs yet
- **Active**: Live ranking with full logging capability
- **Completed**: Final ranking, locked. Winner banner at top. "Challenge Ended" header. All logs read-only.
- **Your rank is changing**: Animated rank position movement when standings shift (smooth vertical slide animation)

### 7.4 Notifications

| Trigger | Message | Priority |
|---------|---------|---------|
| Challenge invitation received | "[Name] invited you to '[Challenge]' in [Circle]" | High |
| Challenge starts today | "[Challenge] starts today — log your first activity!" | High |
| Someone overtakes your rank | "[Name] just passed you. You're now #[N] in [Challenge]." | High |
| You've passed someone | "You passed [Name]! You're now #[N] in [Challenge]." | Medium |
| Milestone reached (25/50/75%) | "You're [X]% of the way through [Challenge]. Keep going!" | Medium |
| Challenge goal completed (100%) | "You completed [Challenge]! Final rank: #[N]" | High |
| No log in 24 hours (active challenge) | "Haven't logged in [Challenge] today. [Name] logged [X] reps." | Medium |
| Challenge ends tomorrow | "[Challenge] ends tomorrow. Final push!" | High |
| Challenge completed (to all participants) | "[Challenge] is over! [Winner] won with [total]. See results." | High |

All notifications link directly to the challenge leaderboard when tapped.

---

## 8. Data Model

All business logic lives in the TypeScript service layer per architectural guidelines. No stored procedures. The following tables support Circle Challenges.

### New Tables

#### `circle_challenges`
The core challenge record.

```
id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
circle_id             UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE
creator_id            UUID NOT NULL REFERENCES profiles(id)
template_id           TEXT                         -- references a hardcoded template enum
name                  TEXT NOT NULL                -- max 50 chars
description           TEXT                         -- max 200 chars
category              TEXT NOT NULL                -- 'strength' | 'cardio' | 'flexibility' | 'wellness' | 'custom'
goal_amount           DECIMAL(12, 2) NOT NULL      -- total challenge goal (e.g., 1000 reps)
unit                  TEXT NOT NULL                -- 'reps' | 'steps' | 'minutes' | 'miles' | custom string
logging_prompt        TEXT                         -- shown at log time (max 60 chars)
is_open               BOOLEAN DEFAULT true         -- open = any circle member can join
status                TEXT NOT NULL DEFAULT 'scheduled'  -- 'scheduled' | 'active' | 'completed' | 'cancelled'
starts_at             TIMESTAMPTZ NOT NULL
ends_at               TIMESTAMPTZ NOT NULL
participant_count     INTEGER DEFAULT 0
winner_user_id        UUID REFERENCES profiles(id) -- set on completion
created_at            TIMESTAMPTZ DEFAULT NOW()
updated_at            TIMESTAMPTZ DEFAULT NOW()
```

**Indexes:**
- `idx_circle_challenges_circle_id` on `(circle_id)`
- `idx_circle_challenges_status` on `(status, starts_at)`
- `idx_circle_challenges_circle_active` on `(circle_id, status)` WHERE `status IN ('scheduled', 'active')`

#### `circle_challenge_participants`
Tracks who is in each challenge and their aggregated totals.

```
id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
challenge_id          UUID NOT NULL REFERENCES circle_challenges(id) ON DELETE CASCADE
user_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
circle_id             UUID NOT NULL REFERENCES challenges(id)  -- denormalized for query efficiency
invited_by            UUID REFERENCES profiles(id)
status                TEXT NOT NULL DEFAULT 'active'  -- 'invited' | 'active' | 'withdrawn'
cumulative_total      DECIMAL(12, 2) DEFAULT 0        -- sum of all log entries
today_total           DECIMAL(12, 2) DEFAULT 0        -- sum of today's log entries (reset daily)
today_date            DATE DEFAULT CURRENT_DATE       -- tracks when today_total was last reset
current_streak        INTEGER DEFAULT 0               -- consecutive days with at least one log
longest_streak        INTEGER DEFAULT 0
last_logged_at        TIMESTAMPTZ                     -- timestamp of most recent log entry
log_count             INTEGER DEFAULT 0               -- total number of log entries
rank                  INTEGER                         -- denormalized rank, recalculated on each log
goal_completion_pct   DECIMAL(5, 2) DEFAULT 0         -- cumulative_total / challenge goal_amount * 100
joined_at             TIMESTAMPTZ DEFAULT NOW()
created_at            TIMESTAMPTZ DEFAULT NOW()
updated_at            TIMESTAMPTZ DEFAULT NOW()

UNIQUE(challenge_id, user_id)
```

**Indexes:**
- `idx_challenge_participants_challenge_id` on `(challenge_id)`
- `idx_challenge_participants_user_id` on `(user_id)`
- `idx_challenge_participants_leaderboard` on `(challenge_id, cumulative_total DESC, today_total DESC, current_streak DESC)` WHERE `status = 'active'`

#### `circle_challenge_logs`
Individual log entries. One participant can have many per day.

```
id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
challenge_id          UUID NOT NULL REFERENCES circle_challenges(id) ON DELETE CASCADE
participant_id        UUID NOT NULL REFERENCES circle_challenge_participants(id) ON DELETE CASCADE
user_id               UUID NOT NULL REFERENCES profiles(id)
circle_id             UUID NOT NULL REFERENCES challenges(id)  -- denormalized
amount                DECIMAL(12, 2) NOT NULL                 -- amount logged in this entry
note                  TEXT                                    -- optional, max 80 chars
logged_at             TIMESTAMPTZ DEFAULT NOW()
log_date              DATE DEFAULT CURRENT_DATE
created_at            TIMESTAMPTZ DEFAULT NOW()
```

**Indexes:**
- `idx_challenge_logs_challenge_id` on `(challenge_id, logged_at DESC)`
- `idx_challenge_logs_participant_id` on `(participant_id, log_date DESC)`
- `idx_challenge_logs_user_date` on `(user_id, challenge_id, log_date DESC)`

#### `circle_challenge_invites`
Tracks challenge-specific invitations (distinct from circle invites).

```
id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
challenge_id          UUID NOT NULL REFERENCES circle_challenges(id) ON DELETE CASCADE
inviter_id            UUID NOT NULL REFERENCES profiles(id)
invitee_id            UUID NOT NULL REFERENCES profiles(id)
status                TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'accepted' | 'declined' | 'expired'
created_at            TIMESTAMPTZ DEFAULT NOW()
responded_at          TIMESTAMPTZ
expires_at            TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'

UNIQUE(challenge_id, invitee_id)
```

### Modified Tables

#### `circle_challenges` → `challenges` (existing)
No modifications needed. The `challenges` table continues to represent the FitCircle itself. `circle_challenges` is a child entity hanging off a FitCircle.

### Derived / Computed

The following are computed in the TypeScript service layer and either cached in the participant record or computed at read time:

- **rank**: Computed by ordering participants by `(cumulative_total DESC, today_total DESC, current_streak DESC, joined_at ASC)` and assigning sequential integers. Stored denormalized in `circle_challenge_participants.rank` and updated on every log insert.
- **goal_completion_pct**: `(cumulative_total / challenge.goal_amount) * 100`, stored in participant record.
- **today_total reset**: The service layer checks `today_date` on participant update — if `today_date < CURRENT_DATE`, it resets `today_total = 0` and sets `today_date = CURRENT_DATE` before applying the new log.

### RLS Policies

All RLS policies follow the simple ownership-check pattern per architectural guidelines:

```sql
-- circle_challenges: visible to circle members
CREATE POLICY "Challenge visible to circle members"
  ON circle_challenges FOR SELECT
  USING (
    auth.uid() IN (
      SELECT user_id FROM circle_members WHERE circle_id = circle_challenges.circle_id
    )
  );

-- circle_challenge_participants: visible to challenge participants and the circle
CREATE POLICY "Participants visible to circle members"
  ON circle_challenge_participants FOR SELECT
  USING (
    auth.uid() IN (
      SELECT user_id FROM circle_members WHERE circle_id = circle_challenge_participants.circle_id
    )
  );

-- circle_challenge_logs: insert by owner only
CREATE POLICY "Users can insert own logs"
  ON circle_challenge_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- circle_challenge_logs: visible to challenge participants
CREATE POLICY "Logs visible to challenge participants"
  ON circle_challenge_logs FOR SELECT
  USING (
    auth.uid() IN (
      SELECT user_id FROM circle_challenge_participants
      WHERE challenge_id = circle_challenge_logs.challenge_id AND status = 'active'
    )
  );
```

---

## 9. Leaderboard Ranking Logic

### Ranking Algorithm

Rankings are recalculated every time a log is inserted. The service layer updates the participant's `cumulative_total`, `today_total`, `rank`, and `goal_completion_pct` within a single transaction.

**Ranking Order (SQL-equivalent):**

```sql
ORDER BY
  cumulative_total DESC,      -- Primary: most total output wins
  today_total DESC,           -- Tiebreaker 1: who did more today
  current_streak DESC,        -- Tiebreaker 2: who is more consistent
  joined_at ASC               -- Tiebreaker 3: earlier joiner wins (loyalty reward)
```

**Rationale for each sort key:**

1. **Cumulative total (primary):** The challenge is explicitly about total output over the duration. The highest total wins. This is unambiguous and everyone understands it.

2. **Today's total (first tiebreaker):** Ties in cumulative total are rare but real, especially in the first few days. Today's total rewards the person who is putting in work right now, which is also the most engaging signal (it changes every time someone logs).

3. **Current streak (second tiebreaker):** Streak as a tiebreaker rewards consistency, which aligns with the wellness goal of the app. It also incentivizes daily logging even when a participant is far behind in absolute terms.

4. **Join date (final tiebreaker):** Rewards participants who committed to the challenge early. Deterministic — no two participants share the same join timestamp.

### Special Case: The Personal Record Hunt Challenge (Template 19)

This template uses improvement percentage rather than absolute totals. Leaderboard for this template uses:

```
improvement_pct = ((best_log_value - baseline_value) / baseline_value) * 100
```

**Primary sort:** `improvement_pct DESC`
**Tiebreaker 1:** `best_log_value DESC` (absolute performance as tiebreaker)
**Tiebreaker 2:** Same as standard algorithm

Baseline value is set by each participant when they join the challenge. The service layer validates that baseline > 0.

### Special Case: The Workout Streak Challenge (Template 18)

```
PRIMARY: current_streak DESC
TIEBREAKER 1: longest_streak DESC
TIEBREAKER 2: total_qualifying_days DESC
TIEBREAKER 3: joined_at ASC
```

A qualifying log for this template is any amount > 0. A day without a log breaks the streak. The streak counter in `circle_challenge_participants.current_streak` is reset to 0 if `last_logged_at` is more than 36 hours before the current time (36 hours to give grace for late-night vs. early-morning logging across days).

### Special Case: The Sleep Streak Challenge (Template 15)

```
PRIMARY: qualifying_nights DESC   (nights where logged hours >= 7)
TIEBREAKER 1: average_logged_hours DESC (across all nights)
TIEBREAKER 2: current_streak DESC
TIEBREAKER 3: joined_at ASC
```

The service layer applies a filter: only log entries of 7+ hours increment `cumulative_total` and `today_total`. Log entries below 7 are stored in `circle_challenge_logs` but marked with a `qualifying` boolean = false, and do not count toward rank.

### Rank Change Detection

After every log insert, the service layer compares the participant's new rank to their prior rank. If rank improved (number decreased), it triggers:
- A Supabase Realtime broadcast on the challenge's channel
- A push notification to the participant whose rank worsened ("you've been passed")

The notification includes the passer's name and the new rank position for the person being passed.

### Display Precision

- Reps, steps, sessions, nights: displayed as integers ("1,240 reps")
- Miles, km, calories, minutes: displayed with one decimal place ("12.4 miles")
- Percentages: displayed with one decimal place ("73.2% to goal")
- Gap display: "82 reps behind [Name]" — always shows unit for clarity

---

## 10. Activity Logging UX

### Design Philosophy

Logging must take under 10 seconds from intent to confirmation. Every additional second of friction reduces logging frequency. The key tension is between expressiveness (adding context, photos, notes) and speed. We resolve this by making the core log flow (open, enter number, tap submit) as fast as possible, and making all enrichment (notes, photos) strictly optional and after the core log is captured.

### Primary Logging Flow

1. User taps "Log Activity" (floating action button, or quick-log from leaderboard)
2. Bottom sheet slides up. Numeric keyboard appears automatically.
3. User sees: today's running total ("120 reps today"), large input field, unit label
4. User types a number.
5. User taps "Log [unit]" button.
6. Sheet dismisses. Micro-animation: number adds to running total with a brief arc animation.
7. Leaderboard rank updates in real time if rank changed.

Total time: 5-8 seconds.

### Enriched Logging Flow (Optional Path)

After the core log is captured, a subtle "Add a note?" prompt appears below the confirmation toast. Tapping it opens a text field inline. This keeps the core path fast while inviting enrichment.

### Quick-Log from Leaderboard

On the challenge leaderboard, the user's own row has a "+ Log" button inline. Tapping it expands a mini input field directly in the row without opening a full sheet. After entering a number and tapping "Add", the row animates to show the updated total and rank. This is the fastest possible log path — zero navigation required.

### Logging Feedback States

**Success:** Green flash on the input, number animates into running total, brief confetti if milestone hit.

**Milestone achieved:** Full-screen celebration moment (3-second overlay, dismissable) showing the milestone badge, the user's name, and a confetti animation. Automatically dismisses.

**Rank changed (moved up):** Toast notification: "You moved up to #[N]!" with an upward arrow animation.

**Rank changed (passed someone):** The person who was passed receives a push notification. No in-app disruption for the logger.

**Max logs reached:** The log button is hidden. A subtle message replaces it: "You've logged 20 times today. Come back tomorrow." No error state — frame it positively.

**Duplicate detection:** If a user logs the exact same value with the exact same note within 60 seconds, show: "Looks like a duplicate — did you mean to log again?" with "Yes, log it" and "Cancel" options.

### Logging History

On the challenge detail screen, an "Activity" tab shows:
- A reverse-chronological feed of all the user's logs for the challenge
- Each entry shows: amount, unit, note (if present), time logged
- Today's entries have an edit (pencil) and delete (trash) icon
- Past-day entries are read-only

This view also shows other participants' logs at the aggregate day level (e.g., "Casey logged 150 reps on March 12") — individual log entries from other participants are not shown to preserve data granularity privacy.

---

## 11. Gamification System

### XP Awards

| Action | XP Earned | Notes |
|--------|----------|-------|
| Create a challenge | 50 XP | One-time per challenge |
| Join a challenge | 25 XP | One-time per challenge |
| First log of the day | 15 XP | Per active challenge |
| Each subsequent log | 5 XP | Per active challenge, per day |
| Maintain a 3-day streak | 30 XP bonus | One-time per streak milestone |
| Maintain a 7-day streak | 75 XP bonus | |
| Reach 25% of challenge goal | 50 XP | One-time per challenge |
| Reach 50% of challenge goal | 100 XP | |
| Reach 75% of challenge goal | 150 XP | |
| Complete challenge goal (100%) | 300 XP | |
| Win a challenge (rank #1) | 500 XP | |
| Finish top 3 | 200 XP | |
| Complete any challenge (any rank) | 100 XP | Completion > winning |
| Give a high-five to a log | 5 XP | Daily cap: 25 XP from high-fives |
| Receive a high-five | 10 XP | Motivational reward |

XP is additive to the global XP system already in place. Challenge XP is tagged with `source: 'circle_challenge'` in the XP event log for analytics segmentation.

### Badges

New challenge-specific badges added to the badge system:

| Badge Name | Trigger | Tier |
|-----------|---------|------|
| First Steps | Complete your first Circle Challenge | Bronze |
| Serial Challenger | Complete 5 Circle Challenges | Silver |
| Challenge Addict | Complete 25 Circle Challenges | Gold |
| Champion | Win your first challenge (rank #1) | Silver |
| Three-Peat | Win 3 challenges | Gold |
| Dominator | Win 5 challenges | Platinum |
| Ironclad | Complete a 30-day challenge | Silver |
| Streak Machine | Maintain a 14-day logging streak | Gold |
| Log Master | Submit 100 total log entries | Silver |
| Early Bird | First to log on a given day in a challenge (3 times) | Bronze |
| Comeback Kid | Win a challenge after being ranked last at the midpoint | Gold |
| Perfect Run | Log every single day of a challenge | Gold |
| Template Explorer | Participate in a challenge from each category | Silver |
| Creator | Create your first challenge | Bronze |
| Organizer | Create 10 challenges | Silver |

### Streak Logic (Challenge-Specific)

Each participant has a per-challenge streak tracked in `circle_challenge_participants.current_streak`. This is independent from the existing global check-in streak.

- A streak day requires at least one log entry for that challenge on that calendar date.
- The streak counter increments when the service detects a log for the current day after a log existed for the previous day.
- A grace period of 36 hours is applied: if a user logs at 11pm on Day N and 1am on Day N+2, the streak is preserved because 36 hours have not elapsed since the most recent prior-day log.
- Streak is reset to 0 if `last_logged_at` is older than 36 hours at the time of a new log entry.

### Milestone Celebrations

At 25%, 50%, 75%, and 100% of the personal goal_completion_pct, the app displays a full-screen celebration overlay:

- 25%: "One quarter done!" + Bronze milestone badge visual
- 50%: "Halfway there!" + Silver milestone badge visual + confetti
- 75%: "Almost there!" + Gold milestone badge visual + confetti
- 100%: "GOAL REACHED!" + full fireworks animation + personal total + rank

These are one-time per challenge. The state is tracked by a `milestone_25_achieved`, `milestone_50_achieved`, `milestone_75_achieved`, `milestone_100_achieved` boolean set of columns on `circle_challenge_participants` (or a JSONB `milestones_achieved` field for compactness).

### End-of-Challenge Celebration

When a challenge ends (scheduled via cron job at `ends_at`), the service:
1. Marks the challenge `status = 'completed'`
2. Locks all logs (no further entries accepted)
3. Sets `winner_user_id` on the challenge to the rank-1 participant
4. Sends push notifications to all participants with final rank
5. Awards XP and badges based on final standings
6. The leaderboard switches to a "Final Results" view with winner podium display (1st, 2nd, 3rd on a stylized podium card)

The winner podium is a full-width card at the top of the completed challenge leaderboard. It shows the top 3 participants with their avatars, names, totals, and medal icons. This is the shareable moment.

---

## 12. Analytics and Instrumentation

### Events to Track

All events follow the naming convention: `challenge_[noun]_[verb]`

| Event Name | Properties | Purpose |
|-----------|-----------|--------|
| `challenge_template_viewed` | template_id, category, source | Understand template discovery |
| `challenge_creation_started` | template_id, circle_id | Funnel tracking |
| `challenge_creation_abandoned` | step, template_id | Drop-off analysis |
| `challenge_created` | challenge_id, template_id, category, duration_days, goal_amount, participant_count_invited | Core feature usage |
| `challenge_invitation_received` | challenge_id, inviter_id | Invitation reach |
| `challenge_joined` | challenge_id, source (invited/open) | Conversion |
| `challenge_invitation_declined` | challenge_id | Friction signal |
| `challenge_log_started` | challenge_id, entry_point (fab/leaderboard/dashboard) | UX analysis |
| `challenge_log_completed` | challenge_id, amount, has_note, daily_log_count, milestone_hit | Core engagement |
| `challenge_log_abandoned` | challenge_id, entry_point | Friction signal |
| `challenge_milestone_reached` | challenge_id, milestone_pct | Engagement |
| `challenge_rank_changed` | challenge_id, old_rank, new_rank, direction (up/down) | Engagement |
| `challenge_high_five_sent` | challenge_id, target_user_id | Social engagement |
| `challenge_notification_tapped` | notification_type, challenge_id | Notification effectiveness |
| `challenge_leaderboard_viewed` | challenge_id, session_duration | Engagement depth |
| `challenge_completed` | challenge_id, final_rank, completion_pct, total_logged | Outcome |
| `challenge_winner_podium_viewed` | challenge_id | Celebration engagement |
| `challenge_result_shared` | challenge_id, platform | Virality |

### Funnels to Monitor

1. **Creation Funnel:** Template viewed → Creation started → Template selected → Config complete → Invited members → Challenge created
2. **Participation Funnel:** Invitation received → App opened → Challenge viewed → Challenge joined
3. **Daily Engagement Funnel:** App opened → Challenge dashboard viewed → Log started → Log completed
4. **Completion Funnel:** Day 1 logged → Day 7 logged → Midpoint logged → Final day logged → Challenge completed

### Key Metrics Dashboard

| Metric | Definition | Target (90 days post-launch) |
|--------|-----------|------------------------------|
| Challenge Creation Rate | Challenges created / active circles / week | 1.5 challenges per circle per week |
| Challenge Participation Rate | % of circle members who join at least one challenge | 70% |
| Daily Log Rate | Logs per active participant per day | 2.1 |
| Challenge Completion Rate | % of participants who log on both Day 1 and the final day | 68% |
| Leaderboard Views per DAU | Leaderboard views / daily active users | 3.2 |
| High-Five Rate | High-fives sent per log entry | 0.4 |
| Notification Open Rate | Tapped / delivered (rank-change notifications) | 38% |
| Winner Share Rate | % of winners who share result to social | 22% |
| Re-challenge Rate | % of challenge completers who start or join another challenge within 7 days | 55% |

### Cohort Analysis

Track weekly cohorts of challenge participants:
- Week 1 log frequency vs. challenge completion rate
- Template category vs. completion rate (which templates have highest completion)
- Challenge duration vs. drop-off rate (where in the duration does engagement fall)
- Circle size vs. challenge participation rate

---

## 13. Success Metrics

### North Star Metric for This Feature

**Weekly Challenge Logs** — the total number of activity log entries submitted by challenge participants per week. This metric captures both challenge participation breadth (how many participants) and logging depth (how often they log).

Target: 50,000 weekly challenge logs within 90 days of launch.

### Primary Metrics

| Metric | Baseline (Pre-launch) | 30-day Target | 90-day Target |
|--------|----------------------|--------------|--------------|
| Active challenges per circle per week | 0 | 0.8 | 1.5 |
| D7 retention for challenge participants | [platform baseline] | [baseline + 5pp] | [baseline + 9pp] |
| D30 retention for challenge participants | [platform baseline] | [baseline + 4pp] | [baseline + 7pp] |
| Sessions per user per day | [platform baseline] | [baseline + 0.8] | [baseline + 1.4] |
| DAU/MAU ratio | [platform baseline] | [baseline + 4pp] | [baseline + 9pp] |
| High-fives sent per day | [platform baseline] | [baseline + 60%] | [baseline + 120%] |
| Challenge completion rate | N/A | 55% | 68% |

All baselines measured in the 30 days prior to feature launch. Baseline is tracked at the cohort level: users who participate in at least one challenge vs. users who are circle members but have not participated in any challenge. This controls for selection effects.

### Secondary Metrics

- NPS delta: Challenge participants vs. non-participants in the same circles
- Invite-to-join conversion rate for challenge invitations
- Template popularity distribution (are users clustering on a few or exploring all 20?)
- Challenge creation per creator (are creators repeat-creating, or one-and-done?)

### Guard Rails (Do Not Degrade)

- Daily check-in rate for existing circle members must not decrease (challenges should be additive to check-in behavior, not a replacement)
- Circle high-five rate outside challenges must not decrease (challenges should amplify social, not concentrate it)
- P95 leaderboard load time must remain under 800ms

---

## 14. Edge Cases and Considerations

### Challenge Participation Edge Cases

**Member leaves circle mid-challenge:** The participant's logs are preserved in `circle_challenge_logs`. Their `circle_challenge_participants.status` is set to 'withdrawn'. They disappear from the active leaderboard but their historical contribution is preserved in the data. If the circle readmits them, their logs reactivate. Do not allow re-joining an in-progress challenge after withdrawal — this prevents gaming (leaving when behind, rejoining with a fresh start).

**Circle is deleted mid-challenge:** Cascade delete removes all challenge data. This is acceptable behavior for MVP — challenge data is subordinate to the circle.

**Challenge creator leaves the circle:** The challenge continues. A new "admin" is not assigned — challenges run autonomously once created. The original creator's participant record behaves the same as any other withdrawal.

**Zero participants after invites declined:** If all invited participants decline and the creator is the only participant, the challenge shows a "No other participants" empty state. The creator can invite more members. The challenge does not auto-cancel.

**Challenge with one participant:** Valid. Single-participant challenges are self-challenges. The leaderboard shows rank #1. XP and badges are still awarded. This encourages creation even in small groups.

### Logging Edge Cases

**Logging after the challenge end time:** The service layer checks `challenge.ends_at` before accepting a log. Any log submitted after `ends_at` is rejected with a clear error: "This challenge has ended. Final results are locked."

**Logging before the challenge start time:** Not possible from the UI (log button is hidden on scheduled challenges). The API still validates and rejects pre-start logs with `status: 400`.

**Decimal units (miles, km, calories):** Input fields for these templates show a decimal keyboard. The service stores values as `DECIMAL(12,2)`. Minimum valid value is 0.1. Display rounds to 1 decimal place.

**Very large cumulative totals:** With a maximum of 20 logs/day, 10,000 per log, and 90-day maximum duration, the theoretical maximum is `20 * 10,000 * 90 = 18,000,000`. `DECIMAL(12,2)` accommodates up to 9,999,999,999.99, so no overflow risk.

**User logs the same number accidentally:** Duplicate detection window: same amount + same note + same participant + within 60 seconds. If all match, show duplicate warning. If amount matches but note differs, allow it (two distinct sets of 20 pushups).

### Fairness and Anti-Gaming

**Log count abuse:** The 20-log-per-day cap limits score inflation. A user who wants to enter 10,000 reps must do so in at most 20 entries. Unusual entry patterns (consistently entering maximum values) may be flagged for review in a future trust-and-safety layer.

**Timezone gaming:** `log_date` is stored in UTC. The "today" window for `today_total` and streak calculations uses UTC date. Edge cases at midnight UTC (11pm US Eastern is 4am next day UTC) are documented and accepted in MVP. A future improvement is to use the user's local timezone stored in their profile preferences.

**Backdating logs:** No backdating. All logs are assigned `log_date = CURRENT_DATE` at the server (not the client). The client does not supply the date. This is enforced in the API layer.

### Leaderboard Edge Cases

**Ties that last the full duration:** The tiebreaker chain (today_total → streak → joined_at) guarantees a unique ordering in all cases because `joined_at` timestamps are unique per participant per challenge. There will always be a unique rank #1.

**Participant count changes mid-challenge:** When a new participant joins an open challenge after it has started, they start with 0 cumulative total and are ranked last. They can catch up through high-frequency logging. The leaderboard shows their join date in their tooltip/profile card to provide context.

**Empty leaderboard:** A challenge with only the creator (no other participants yet) shows the creator at rank #1 with a "Invite others to make it competitive" CTA.

### Technical Edge Cases

**Realtime connection drops:** The leaderboard falls back to polling (60-second interval) without visible degradation. A subtle "Live updates paused — reconnecting" indicator appears. When reconnected, the leaderboard refreshes immediately.

**Concurrent log submissions from two participants:** The `cumulative_total` and `rank` fields in `circle_challenge_participants` are updated transactionally. Two simultaneous logs for different participants do not conflict. Two simultaneous logs from the same participant (possible if user double-taps the submit button) are handled by the duplicate detection logic and the API's idempotency check on the 60-second window.

**Cron job for challenge status transitions:** A daily cron job runs at 00:01 UTC to:
1. Activate challenges whose `starts_at` has passed and `status = 'scheduled'`
2. Complete challenges whose `ends_at` has passed and `status = 'active'`
3. Award end-of-challenge XP and badges
4. Send end-of-challenge notifications

The cron endpoint follows the existing pattern at `/api/cron/process-challenges`. It is secured with `CRON_SECRET` header validation.

---

## 15. MVP vs. Future Phases

### MVP (Phase 1 — Core Feature)

**What is included:**
- Challenge creation with all 20 templates
- Manual activity logging (numeric input, multiple per day)
- Real-time circle leaderboard
- Challenge-specific XP rewards and badges (15 new badges)
- Milestone celebrations (25/50/75/100%)
- Push notifications: invitation, rank change, milestone, completion
- High-fives on log entries
- Challenge history view per circle
- Cron job for automated status transitions and end-of-challenge processing

**What is explicitly deferred:**

| Feature | Reason | Target Phase |
|---------|--------|-------------|
| Photo/video proof of logging | Infrastructure complexity, storage costs | Phase 2 |
| Wearable auto-sync (Apple Health, Google Fit) | Requires native app features or HealthKit API work | Phase 2 |
| Team vs. team challenge format | Data model complexity, UI complexity | Phase 2 |
| Public challenge discovery (browse outside your circle) | Network effects not established yet | Phase 3 |
| Monetary prize challenges | Legal/regulatory review required | Phase 3 |
| Challenge comments/chat thread | Social feature scope, separate from high-fives | Phase 2 |
| Challenge scheduling (recurring weekly challenges) | Creator UX complexity | Phase 2 |
| Challenge analytics dashboard for creators | Nice-to-have, complex UI | Phase 2 |
| Leaderboard filter (weekly / all-time / today-only) | UI complexity for MVP | Phase 2 |
| Push notifications for "No log in 24 hours" | Requires careful tuning to avoid spam perception | Phase 2 |

### Phase 2 — Deepening Engagement

**Priority additions after MVP metrics are established:**
1. **Wearable auto-sync**: Steps and active minutes auto-logged from Apple Health / Google Fit. This requires the iOS native app to be further along but is the single highest-impact engagement feature available.
2. **Photo logging**: Optional photo attachment to log entries. Photo is shown in the activity feed. Not used for verification, only social richness.
3. **Challenge chat**: A dedicated comment thread per challenge, separate from the circle's main feed. Enables mid-challenge banter and motivation.
4. **Recurring challenges**: Creator sets a cadence (every 7 days, every month) and the challenge auto-restarts with the same participants. Dramatically increases re-challenge rate.
5. **No-log nudge notifications**: If a participant hasn't logged in a challenge in 24 hours, send a contextual nudge with the current leaderboard snapshot. Requires careful tuning.

### Phase 3 — Platform Expansion

1. **Team challenges**: Circles split into teams, team cumulative totals compete. Requires team formation UI.
2. **Public challenge templates**: Community-created and voted-on templates appear in a public template library.
3. **Corporate wellness challenges**: Large-group challenges (50+ participants, organization-scoped) with admin dashboards.
4. **Monetary prizes**: Post legal review, introduce optional prize pools funded by participants.

---

## 16. Technical Considerations

### Service Layer Architecture

Following the established pattern in `/apps/web/app/lib/services/`, create:

- **`challenge-service.ts`**: Core challenge CRUD, status transitions, participant management
- **`challenge-log-service.ts`**: Log entry creation, today_total reset logic, duplicate detection
- **`challenge-leaderboard-service.ts`**: Rank calculation, rank-change detection, Realtime broadcast
- **`challenge-notification-service.ts`**: Push notification triggers for all challenge events
- **`challenge-cron-service.ts`**: Called by the cron endpoint to process scheduled/completed challenges

### API Routes

New routes under `/apps/web/app/api/circles/[circleId]/challenges/`:

```
GET    /                          — List active and past challenges for a circle
POST   /                          — Create a new challenge
GET    /[challengeId]             — Get challenge detail + participant list
PATCH  /[challengeId]             — Update challenge (creator only, pre-start)
DELETE /[challengeId]             — Cancel challenge (creator only, pre-start)
POST   /[challengeId]/join        — Join an open challenge
POST   /[challengeId]/logs        — Submit a log entry
GET    /[challengeId]/logs        — Get own log history for challenge
DELETE /[challengeId]/logs/[logId] — Delete a log entry (today only)
GET    /[challengeId]/leaderboard — Get current leaderboard
POST   /[challengeId]/high-fives  — Send a high-five to a log entry
GET    /templates                 — Get all available challenge templates
```

Cron endpoint (existing pattern):
```
GET /api/cron/process-challenges  — Activate scheduled, complete active, award XP
```

### Realtime Architecture

Use Supabase Realtime channels per challenge. When a log is inserted:

1. API route calls `challenge-log-service.ts` to insert the log
2. Service updates `circle_challenge_participants` (cumulative_total, today_total, rank)
3. Service detects rank changes and calls `challenge-notification-service.ts`
4. Service broadcasts to the Supabase Realtime channel `challenge:[challengeId]` with the updated leaderboard snapshot

Frontend subscribes to `challenge:[challengeId]` when the challenge leaderboard is visible. On broadcast received, it updates the leaderboard state without a full refetch. This minimizes DB reads while keeping the leaderboard visually live.

### Performance Requirements

- Leaderboard initial load: P95 < 800ms
- Log submission round-trip: P95 < 400ms (user sees optimistic update immediately, server confirms)
- Rank recalculation: Must complete within the log submission round-trip — no async processing for rank (this keeps the rank accurate without eventual consistency lag)
- Max concurrent active challenges per circle: 10 (enforced in service layer). More than 10 simultaneously active challenges is a UX anti-pattern and a performance guard.

### Optimistic Updates

The log submission should use optimistic updates in the frontend:
1. User taps "Log"
2. UI immediately increments running total and applies animation (optimistic)
3. API call fires in background
4. On success: confirm state
5. On failure: revert optimistic state and show error toast

This makes the logging feel instant even on slower connections.

---

## 17. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Low challenge creation rate (circles don't start challenges) | Medium | High | Ensure challenge creation is surfaced prominently in the circle dashboard; add an onboarding prompt for circle admins; send a "Start your first challenge" email 3 days after circle creation |
| High creation, low participation (creator-only challenges) | Medium | Medium | Default to "open to all circle members" and send automatic invitations to all circle members for the first challenge in a circle |
| Logging fatigue (too many active challenges simultaneously) | Low | Medium | Cap at 10 active challenges per circle; surface active challenges prominently with visual distinction between them |
| Rank-change notifications feel spammy | Medium | Medium | Rate-limit rank-change notifications to 1 per hour per challenge per user; let users configure notification preferences |
| Leaderboard feels discouraging for beginners | Medium | High | Always show the gap to next rank (not just rank), enabling beginners to focus on achievable micro-goals; consider normalized views in Phase 2 |
| Gaming / inflated logging (entering false numbers) | Low (social setting) | Medium | Log-count cap (20/day), duplicate detection, and social visibility (circle members see each other's totals) create natural social moderation; formal anti-cheat is Phase 2 |
| Challenge data volume scaling | Low | High | `circle_challenge_logs` table will grow with usage; partition by `log_date` if volume exceeds 10M rows; add log retention policy (archive logs older than 1 year) |
| Template variety insufficient | Low | Low | 20 templates covers the core use cases; Custom template covers anything not in the list; template library is designed to expand without schema changes |
| Wearable-dependent users feel disadvantaged | Low | Medium | Manual logging is intentional for MVP equality; Phase 2 wearable sync is clearly communicated in the template descriptions ("log your steps from any source") |

---

## Appendix: Challenge Template Quick Reference

| # | Name | Category | Default Goal | Unit | Duration | Difficulty |
|---|------|----------|-------------|------|----------|-----------|
| 1 | Pushup Push | Strength | 500 | Reps | 7 days | Beginner+ |
| 2 | Squat Squad | Strength | 1,000 | Reps | 10 days | Beginner+ |
| 3 | Plank Challenge | Strength | 60 | Minutes | 14 days | Intermediate |
| 4 | Burpee Blitz | Strength | 300 | Reps | 7 days | Intermediate+ |
| 5 | Pull-Up Progress | Strength | 200 | Reps | 14 days | Advanced |
| 6 | Step Sprint | Cardio | 70,000 | Steps | 7 days | Beginner |
| 7 | Miles on the Board | Cardio | 26.2 | Miles | 14 days | Intermediate |
| 8 | Calorie Burn Battle | Cardio | 5,000 | Calories | 14 days | Intermediate |
| 9 | Active Minutes | Cardio | 300 | Minutes | 14 days | Beginner |
| 10 | Cycling Century | Cardio | 100 | Miles | 21 days | Intermediate |
| 11 | Stretch It Out | Flexibility | 30 | Sessions | 30 days | Beginner |
| 12 | Yoga Flow | Flexibility | 300 | Minutes | 30 days | Beginner+ |
| 13 | Foam Roller Recovery | Flexibility | 20 | Sessions | 21 days | Beginner |
| 14 | Hydration Nation | Wellness | 56 | Glasses | 7 days | Beginner |
| 15 | Sleep Streak | Wellness | 14 | Qualifying nights | 21 days | Beginner |
| 16 | Mindfulness Minutes | Wellness | 150 | Minutes | 21 days | Beginner |
| 17 | Veggie Wins | Wellness | 70 | Servings | 7 days | Beginner |
| 18 | Workout Streak | Custom | Every day | Qualifying days | 14 days | Intermediate |
| 19 | Personal Record Hunt | Custom | User-defined | User-defined | 21 days | Variable |
| 20 | Custom Challenge | Custom | User-defined | User-defined | User-defined | Variable |

---

*This document is ready for engineering estimation and design review. Questions or scope changes should be discussed before sprint planning.*
