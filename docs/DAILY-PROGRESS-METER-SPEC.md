# Daily Progress Meter - Product Specification
**Version 1.0 | Created: October 25, 2025**

## Executive Summary

The Daily Progress Meter transforms FitCircle's dashboard from a simple check-in tracker into an intelligent daily goal system that bridges the gap between long-term FitCircle challenges and daily actionable targets. This feature is critical for retention, as it provides users with clear, achievable daily goals that ladder up to their longer-term objectives.

### Key Objectives
- **Increase D7 retention** from current baseline to 35%+ by providing daily engagement hooks
- **Boost daily active usage** by 40% through clear daily goal completion mechanics
- **Improve challenge completion rates** by breaking down long-term goals into daily milestones
- **Enhance user motivation** through immediate visual feedback and progress celebration

### Success Metrics
- Daily Active Users (DAU) increase of 40%
- Average session frequency increases from current to 12+ per week
- Daily goal completion rate of 65%+
- User NPS improvement of +8 points

---

## 1. Competitive Analysis

### Research Summary

I analyzed 5 leading fitness apps to understand best practices for daily vs long-term goal tracking:

#### 1.1 Apple Fitness Rings

**Strengths:**
- **Three concentric rings** (Move, Exercise, Stand) provide at-a-glance daily progress
- **Rings close when goals are met** - incredibly satisfying visual feedback
- **Adaptive goals** - Apple Watch suggests goal adjustments based on activity patterns
- **Simple, glanceable design** - users spend <3 seconds checking progress
- **Streak tracking** - celebrates consecutive days of ring closure

**Weaknesses:**
- Limited to activity metrics only (no weight loss integration)
- No connection between daily rings and long-term goals
- Goals are independent (not coordinated toward a single objective)

**Key Learnings for FitCircle:**
- Use circular/ring visualization for daily progress (aligns with brand design)
- Make goal completion visually celebratory (closing the ring = dopamine hit)
- Keep daily view simple: 2-3 key metrics maximum
- Suggest adaptive goals based on user's baseline activity

---

#### 1.2 MyFitnessPal

**Strengths:**
- **Daily macro tracking** with meal-by-meal breakdown
- **Weekly Digests** show how daily actions trend over time
- **Preliminary data shows 50% of daily loggers achieve 5% weight loss in 4 months**
- **Users logging 4+ days in first week are 7x more likely to make progress**
- **Custom goals by day of week** (Premium feature)
- **Progress tab** clearly separates daily logs from long-term trends

**Weaknesses:**
- Daily calorie tracking can be tedious (high friction)
- No visual "daily goal meter" - relies on numerical summaries
- Long-term goal connection is implicit, not explicit

**Key Learnings for FitCircle:**
- First-week daily engagement is CRITICAL (4-day rule)
- Weekly trend summaries help users see daily → long-term connection
- Day-of-week customization is valuable (e.g., higher step goals on weekdays)
- Keep daily logging low-friction (FitCircle's quick-entry cards are ideal)

---

#### 1.3 Strava

**Strengths:**
- **Flexible goal timeframes** (weekly, monthly, annual)
- **Multiple metrics** (distance, time, activities, elevation)
- **Combined sport types** - aggregate progress across activity types
- **Retroactive goal tracking** - goals pull historical data
- **Privacy by default** - progress goals are private, completions are public
- **Activity feed integration** - goal completion banners celebrate success

**Weaknesses:**
- Premium-only feature (limits adoption)
- No intelligent daily breakdowns from long-term goals
- Manual goal setting (no recommendations)

**Key Learnings for FitCircle:**
- Support multiple simultaneous goals (weight + steps + workouts)
- Make goal completion celebrations public to social feed
- Allow retroactive tracking when users set new goals
- Keep daily progress private, celebrate milestones publicly

---

#### 1.4 Fitbit

**Strengths:**
- **Personalized daily goals** based on baseline activity (e.g., if averaging 9,200 steps, recommends 10,000)
- **Incremental progression strategy** - small weekly increases vs jumping to ambitious targets
- **Daily Readiness Score** (Premium) - adapts daily goals based on recovery needs
- **3-month habit formation philosophy** - sustainable goal setting
- **Default 10,000 steps** with sensible starter alternatives (5,000 or 7,000 for sedentary users)

**Weaknesses:**
- Limited visual progress representation
- Long-term goals are disconnected from daily metrics
- Readiness Score requires Premium subscription

**Key Learnings for FitCircle:**
- **Baseline-adjusted recommendations** are key to sustainable goals
- Start conservative (5k-7k steps) for new users, not aggressive (10k)
- Build toward 3-month habit formation
- Adapt daily goals dynamically (easier on recovery days, harder on active days)

---

#### 1.5 Industry Best Practices (2025 Research)

Based on recent UX/UI studies for fitness apps:

**Visual Progress Tracking:**
- **Graphs and trend lines** boost engagement by showing weekly/monthly comparisons
- **Badges and achievements** for milestone unlocks
- **Streak counters** display consistency (e.g., "5 days in a row")
- Visual progress creates sense of achievement and habit formation

**Glanceable Design:**
- Users spend **<3 seconds interpreting metrics** on mobile
- Show **2-3 key stats maximum** per screen
- Reduce cognitive load by minimizing on-screen elements
- **45% boost in task completion** with simplified designs

**Personalized Notifications:**
- **40% engagement boost** with activity-calibrated notifications
- Tailor alerts to inactivity moments or goal progress
- Don't bombard with generic reminders

**Goal Setting & Milestones:**
- Break big goals into **smaller milestones** to reduce overwhelm
- Celebrate **mini-wins** to reinforce progress
- Display goals as **To Do / Doing / Done** categories
- Focus on **personal growth vs social comparison**

**Home Screen Principles:**
- Show **recent activity + progress toward specific goal**
- Keep it simple to summarize experience
- Motivate users to discover app features

---

### 1.6 Competitive Positioning for FitCircle

**What We Do Better:**
1. **Integrated daily-to-long-term goal system** - unique connection between daily progress and FitCircle challenge outcomes
2. **Multi-metric daily goals** - not just steps or calories, but holistic (weight check-in + steps + mood)
3. **Social accountability built-in** - daily progress visible to FitCircle members (with privacy controls)
4. **AI-driven goal recommendations** - Fitzy calculates optimal daily targets based on challenge math
5. **Circular design language** - Apple Watch-inspired rings + progress meters align with brand
6. **Zero premium paywall** - daily goal tracking is core free feature

**Our Advantages:**
- FitCircle challenges provide **external motivation** (competition, prizes, social pressure)
- Daily goals become **team accountability tool** ("Did you close your rings today?")
- Progress toward challenge = progress in daily meter (perfect alignment)

---

## 2. Feature Specification

### 2.1 User Flow: Setting Up Daily Goals

#### First-Time User Experience

**Scenario:** User joins their first FitCircle challenge (e.g., "Lose 10 lbs in 8 weeks")

1. **Challenge Join Confirmation Screen**
   - After user joins FitCircle, show modal: "Let's set your daily goals!"
   - Explain: "We'll break down your 10 lb goal into daily targets to keep you on track."

2. **Daily Goal Recommendation Screen**
   - **Display calculated daily targets:**
     - Weight: "Log your weight daily" (encourages consistency)
     - Steps: "Walk 8,500 steps per day" (based on user's baseline or default)
     - Optional: "Complete 1 check-in per day" (mood/energy tracking)

   - **Show the math (transparency builds trust):**
     - "To lose 10 lbs in 8 weeks, aim for 1.25 lbs per week"
     - "Daily calorie deficit: ~625 cal (achieved through activity + nutrition)"
     - "Recommended steps: 8,500/day (burns ~250 extra calories vs baseline)"

3. **Customization Options**
   - Allow user to adjust daily step goal (+/- 2,000 steps)
   - Choose daily check-in frequency (every day, weekdays only, flexible)
   - Set reminder times (morning weigh-in, evening step check)

4. **Confirmation & Dashboard Update**
   - "Your daily goals are set! Complete them each day to stay on track for your FitCircle."
   - Dashboard circle now shows **Daily Progress** (not generic 17%)

#### Returning User: Adding New Challenge

**Scenario:** User is already in a FitCircle (weight loss) and joins a second FitCircle (step challenge)

1. **Goal Conflict Detection**
   - System detects user now has two active challenges with different metrics
   - Show notification: "You're in 2 FitCircles! Let's update your daily goals."

2. **Multi-Goal Dashboard View**
   - Dashboard circle becomes **dual-ring** or **segmented circle**:
     - Outer ring: Weight loss progress (%)
     - Inner ring: Step challenge progress (%)

   - Alternatively: **Tabbed view** to switch between FitCircle daily goals

3. **Priority Selection**
   - Ask user: "Which FitCircle is your primary focus?"
   - Primary FitCircle's daily goal shows on main dashboard circle
   - Secondary FitCircle(s) shown as smaller cards below

4. **Aggregated Daily Goal**
   - If both challenges require steps, use **highest step goal**
   - If challenges are compatible (weight + steps), show **combined daily checklist**:
     - ✓ Log weight today
     - ✓ Walk 10,000 steps
     - ✓ Check in with mood/energy

---

### 2.2 How Daily Goals Are Calculated

#### Weight Loss Challenges

**Inputs:**
- Starting weight: `S` (kg)
- Goal weight: `G` (kg)
- Challenge duration: `D` (days)
- User's baseline activity: `B` (steps/day, from historical data or default 5,000)

**Calculation:**

1. **Total weight to lose:** `L = S - G` (e.g., 10 lbs = 4.5 kg)

2. **Daily weight loss target:** `L / D` (e.g., 4.5 kg / 56 days = 0.08 kg/day = 0.18 lbs/day)

3. **Calorie deficit needed:**
   - 1 lb fat = ~3,500 calories
   - Daily deficit = `(L * 2.2 lbs * 3500 cal) / D`
   - Example: `(4.5 * 2.2 * 3500) / 56 = 617 cal/day`

4. **Recommended daily step goal:**
   - Baseline activity: 5,000 steps = ~2,000 calories burned
   - Each 1,000 steps ≈ 40-50 calories
   - To burn extra 300 cal/day through steps: add ~6,000 steps
   - **Daily step goal = Baseline + 6,000 = 11,000 steps**

5. **Fallback/Simplified Logic (if no baseline data):**
   - Light goals (<5 lbs): 8,000 steps/day
   - Moderate goals (5-15 lbs): 10,000 steps/day
   - Aggressive goals (>15 lbs): 12,000 steps/day

**Daily Goal:**
- Log weight: Yes (every day for accountability)
- Steps: 10,000 (calculated above)
- Optional: Calorie tracking, workout logging (Phase 2)

---

#### Step Challenges

**Inputs:**
- Challenge type: "Walk 300,000 steps in 30 days"
- Duration: 30 days
- User's baseline: 6,000 steps/day

**Calculation:**

1. **Total steps needed:** 300,000
2. **Daily target:** `300,000 / 30 = 10,000 steps/day`
3. **Adjustment for baseline:**
   - If user averages 6k steps, 10k is +67% increase
   - System suggests: "This is a challenging goal! Consider starting at 8,500 steps/day for first week."

**Daily Goal:**
- Steps: 10,000
- Stretch goal: 12,000 (for bonus points/leaderboard position)

---

#### Workout Frequency Challenges

**Inputs:**
- Challenge: "Complete 20 workouts in 4 weeks"
- Duration: 28 days

**Calculation:**

1. **Workouts per week:** `20 / 4 = 5 workouts/week`
2. **Daily frequency:** `5 / 7 = 0.71 workouts/day` (not practical)

**Smart Daily Goal:**
- Instead of "0.71 workouts/day", show:
  - "Complete 5 workouts this week"
  - Daily meter shows: "2 of 5 workouts done this week"
  - Progress: 40% (weekly rolling progress)

**Alternative Daily Checklist:**
- Mon, Wed, Fri, Sat, Sun = workout days (5/week)
- Daily goal: "Is today a workout day? ✓ Complete 1 workout"

---

#### Custom Challenges

**Inputs:**
- User-defined goal: "Meditate 15 minutes daily for 30 days"

**Daily Goal:**
- Meditation: 15 minutes (binary: yes/no)
- Progress: 23 of 30 days completed (77%)

---

### 2.3 Metrics Tracked Daily

Based on current `daily_tracking` schema and competitive analysis:

#### Core Metrics (MVP)

1. **Weight (kg)**
   - Daily log (optional, but encouraged for weight loss challenges)
   - Shows: Latest weight + trend (up/down from yesterday)
   - Privacy: Private by default, can share with FitCircle

2. **Steps (count)**
   - Daily log (required for step challenges)
   - Shows: Progress toward daily step goal (e.g., 7,234 / 10,000)
   - Can sync from Apple Health, Google Fit (Phase 2)

3. **Check-in Completion (binary)**
   - Did user complete daily check-in? (weight + steps + mood)
   - Shows: Streak counter (e.g., "5-day streak!")

4. **Mood Score (1-10)**
   - Optional wellness tracking
   - Shows: Weekly mood trend

5. **Energy Level (1-10)**
   - Optional wellness tracking
   - Shows: Correlation with activity levels

---

#### Phase 2 Metrics (Nice-to-Have)

6. **Calories Consumed** (integration with MyFitnessPal or manual log)
7. **Workouts Completed** (count, type, duration)
8. **Water Intake** (glasses/liters)
9. **Sleep Hours** (from wearable sync or manual)
10. **Body Measurements** (waist, hips, chest - weekly)

---

### 2.4 Dashboard Circle Visualization

#### Current State
- Generic circular progress (17% complete)
- Steps count + streak counter
- No connection to goals

#### Proposed Daily Progress Meter

**Design Concept: Apple Fitness-Inspired Activity Rings**

**Visual Structure:**

```
┌─────────────────────────────────┐
│                                 │
│         ╭──────────╮            │
│       ╱  ╭────╮    ╲           │
│     ╱   ╱      ╲    ╲          │  ← Outer Ring: Steps
│    │   │  80%   │   │          │    Color: Indigo (#6366f1)
│    │   │        │   │          │
│     ╲   ╲      ╱   ╱           │  ← Inner Ring: Weight Log
│       ╲  ╰────╯   ╱            │    Color: Purple (#8b5cf6)
│         ╰────────╯              │
│                                 │
│      Daily Goal Progress        │
│                                 │
│   ✓ Logged weight today         │
│   ⬤ 8,234 / 10,000 steps (82%)  │
│   ⬤ 5-day streak 🔥             │
│                                 │
└─────────────────────────────────┘
```

**Key Design Elements:**

1. **Dual-Ring System** (if user has multiple active goals)
   - **Outer ring:** Primary metric (usually steps)
   - **Inner ring:** Secondary metric (weight logging completion)
   - Rings fill clockwise as goals are met
   - Rings "close" (100% fill) with satisfying animation + haptic feedback

2. **Single-Ring System** (if user has one active goal)
   - Large circular progress meter
   - Shows percentage + absolute values
   - Color-coded by metric type:
     - Steps: Indigo
     - Weight loss: Purple
     - Streak: Orange
     - Workouts: Green

3. **Center Display**
   - Primary metric value (e.g., "8,234 steps")
   - Progress percentage (82%)
   - Or: Completion status ("2 of 3 goals complete")

4. **Below-Circle Summary**
   - ✓ Checkmark for completed goals (green)
   - ⬤ Progress circle for in-progress goals (color-coded)
   - Streak counter with flame icon
   - Tap to expand for details

---

#### Responsive Behavior

**Mobile (Primary View):**
- Circle: 200px diameter
- Dual rings: 12px stroke width each
- Center text: 24px bold (primary metric)
- Below summary: 3 rows, compact

**Desktop:**
- Circle: 280px diameter
- Dual rings: 16px stroke width
- Center text: 32px bold
- Below summary: Expanded cards with trend graphs

---

#### Interaction States

**1. No Goals Set (New User)**
```
┌─────────────────────────────────┐
│         ╭──────────╮            │
│       ╱            ╲           │
│     ╱                ╲          │
│    │    Set Your      │         │
│    │   Daily Goals    │         │
│     ╲                ╱          │
│       ╲            ╱            │
│         ╰────────╯              │
│                                 │
│   [Set Goals Button]            │
└─────────────────────────────────┘
```

**2. In Progress (Partial Completion)**
```
┌─────────────────────────────────┐
│         ╭──────────╮            │
│       ╱  ╭────╮    ╲           │  Outer: 65% filled (indigo)
│     ╱   ╱ 65%  ╲    ╲          │  Inner: 100% filled (purple)
│    │   │ 6.5k  │   │           │
│    │   │ steps │   │           │
│     ╲   ╲      ╱   ╱           │
│       ╲  ╰────╯   ╱            │
│         ╰────────╯              │
│                                 │
│   ✓ Logged weight               │
│   ⬤ 6,522 / 10,000 steps (65%)  │
│   🔥 5-day streak                │
└─────────────────────────────────┘
```

**3. Goal Completed! (Celebration)**
```
┌─────────────────────────────────┐
│    ✨   ╭──────────╮   ✨       │
│       ╱  ╭────╮    ╲           │  Both rings: 100% filled
│     ╱   ╱ 🎉  ╲    ╲          │  Glowing animation
│    │   │ Done! │   │           │  Confetti particles
│    │   │       │   │           │
│     ╲   ╲      ╱   ╱           │
│       ╲  ╰────╯   ╱            │
│    ✨   ╰────────╯   ✨         │
│                                 │
│   🏆 All goals complete!         │
│   Share your progress →         │
└─────────────────────────────────┘
```

**4. Multiple Active FitCircles**
```
┌─────────────────────────────────┐
│  [Weight Loss ▼] [Steps Challenge] │  ← Tabs
│                                 │
│         ╭──────────╮            │
│       ╱  ╭────╮    ╲           │
│     ╱   ╱      ╲    ╲          │
│    │   │  65%   │   │          │
│    │   │        │   │          │
│     ╲   ╲      ╱   ╱           │
│       ╲  ╰────╯   ╱            │
│         ╰────────╯              │
│                                 │
│   Weight Loss FitCircle:        │
│   ✓ Logged weight (172.3 lbs)   │
│   ⬤ 6,522 / 10,000 steps (65%)  │
│                                 │
│   [View Steps Challenge →]      │
└─────────────────────────────────┘
```

---

### 2.5 What Happens When Users Complete/Miss Daily Goals

#### Goal Completion

**Immediate Feedback:**
1. **Visual Celebration**
   - Ring completion animation (sweeping fill + glow effect)
   - Confetti particles (Framer Motion animation)
   - Haptic feedback (mobile devices)
   - Sound effect (optional, user preference)

2. **Toast Notification**
   - "🎉 Daily goals complete! You're on track for your FitCircle."
   - Shows XP earned: "+25 XP"
   - Streak update: "6-day streak! Keep it up!"

3. **Social Sharing Prompt**
   - "Share your achievement with your FitCircle?"
   - Quick-share to FitCircle feed: "John just closed his rings! 🔥"
   - Optional: Share to Instagram/Twitter with branded graphic

4. **Leaderboard Update**
   - User's position in FitCircle leaderboard updates in real-time
   - If user moves up ranks: "You're now #3 in your FitCircle!"

5. **XP & Achievement Unlocks**
   - Award 25 XP for daily goal completion
   - Check for streak milestones:
     - 7 days: "Week Warrior" badge
     - 14 days: "Fortnight Champion" badge
     - 30 days: "Monthly Legend" badge
   - Progress toward level-up: "340 / 500 XP to Level 8"

---

#### Missing Daily Goals

**Evening Reminder (8 PM, configurable):**
- Push notification: "Your daily goals are almost due! 2,000 steps to go."
- Show time remaining: "4 hours left to close your rings"

**Next Day (Goal Missed):**

1. **Gentle Accountability (No Shame)**
   - Dashboard shows: "Yesterday's goals: Incomplete"
   - No negative XP penalty (research shows punishment reduces retention)
   - Streak counter shows: "0 days" (resets, but shows "Best streak: 5 days")

2. **Motivational Messaging**
   - "That's okay! Let's get back on track today."
   - Show progress: "You've completed 5 of 7 days this week - 71% success rate!"
   - "Your FitCircle is counting on you! Check in today to support the team."

3. **Adaptive Goal Suggestion**
   - If user missed goal 3+ times in a week, prompt:
     - "Your daily step goal might be too high. Adjust to 7,500 steps?"
     - "Life happens! Set a more flexible goal for this week."

4. **FitCircle Impact (Transparent, Not Punitive)**
   - "Missing daily goals affects your FitCircle's team score."
   - Show team leaderboard position: "Team rank: #4 of 10"
   - Gentle peer pressure: "Sarah and Mike completed their goals yesterday!"

5. **Recovery Mode**
   - If user misses 3+ days in a row:
     - Unlock "Recovery Day" feature
     - Lower daily goal for 1 day to rebuild momentum
     - "Today's goal: 5,000 steps (reduced to help you restart)"

---

#### Weekly Summary (Every Monday)

**Digest Notification:**
- "Last week: You completed daily goals 5 of 7 days (71%)"
- Show weekly trend graph
- Celebrate wins: "You beat your step goal by 15% on average!"
- Areas for improvement: "Try logging weight more consistently this week."

**Weekly Recommendations:**
- "Based on your performance, we suggest:"
  - Increase step goal to 11,000 (you're consistently hitting 10k)
  - OR: Reduce step goal to 8,500 (you've missed target 4 days)

---

### 2.6 Multi-Goal Management (Multiple Active FitCircles)

**Problem:**
Users can join multiple FitCircles with different goals:
- FitCircle A: Weight loss (lose 10 lbs in 8 weeks)
- FitCircle B: Step challenge (walk 500,000 steps in 30 days)
- FitCircle C: Workout frequency (complete 20 workouts in 4 weeks)

**How do we show daily progress for all three without overwhelming the user?**

---

#### Solution 1: Primary + Secondary Goals (Recommended for MVP)

**Design:**
1. **User selects Primary FitCircle** (on first multi-goal setup)
   - "Which FitCircle is most important to you right now?"
   - Primary FitCircle's daily goal shows in main dashboard circle

2. **Secondary FitCircles shown as compact cards below**
   - Smaller progress rings (120px diameter)
   - Title: FitCircle name
   - Progress: "8,234 / 10,000 steps today (82%)"
   - Tap to expand details

3. **"View All Goals" Button**
   - Opens full-screen multi-goal dashboard
   - Shows all FitCircles in grid layout
   - Can switch primary goal here

**Visual Mockup:**
```
┌─────────────────────────────────┐
│  PRIMARY: Weight Loss Challenge │
│                                 │
│         ╭──────────╮            │
│       ╱            ╲           │  Main circle
│     ╱      65%      ╲          │  (weight loss daily goal)
│    │                │           │
│     ╲              ╱            │
│       ╰──────────╯              │
│                                 │
│   ✓ Weight logged               │
│   ⬤ 6,522 / 10,000 steps        │
├─────────────────────────────────┤
│  OTHER FITCIRCLES:              │
│                                 │
│  ┌──────────┐  ┌──────────┐    │
│  │   82%    │  │   60%    │    │  Smaller circles
│  │  Steps   │  │ Workouts │    │  (secondary goals)
│  └──────────┘  └──────────┘    │
│                                 │
│  [View All Goals →]             │
└─────────────────────────────────┘
```

---

#### Solution 2: Unified Daily Checklist (Alternative)

**Design:**
- Instead of separate circles, show **unified daily checklist**
- All daily goals from all FitCircles combined
- User checks off items as they complete them

**Visual Mockup:**
```
┌─────────────────────────────────┐
│       Today's Goals (3/5)       │
│                                 │
│   ✓ Log weight (Weight Loss)    │
│   ✓ Walk 10,000 steps (Steps)   │
│   ✓ 1 workout (Workout Freq)    │
│   ⬤ Eat 1,800 cal (Weight Loss) │
│   ⬤ Log mood/energy (All)       │
│                                 │
│         ╭──────────╮            │
│       ╱            ╲           │  Overall completion
│     ╱      60%      ╲          │  (3 of 5 goals done)
│    │                │           │
│     ╲              ╱            │
│       ╰──────────╯              │
└─────────────────────────────────┘
```

**Pros:**
- Single unified view
- Clear daily checklist
- Progress aggregated across all challenges

**Cons:**
- Loses per-FitCircle granularity
- Harder to track which challenge is progressing well

**Recommendation:** Use Solution 1 for MVP (Primary + Secondary), offer Solution 2 as alternative view mode in Settings.

---

#### Solution 3: Tabbed FitCircle Views (Phase 2)

**Design:**
- Tabs at top: [Weight Loss] [Steps] [Workouts]
- Main circle changes based on selected tab
- Each tab shows that FitCircle's daily goal progress

**Pros:**
- Clear separation of FitCircles
- Can see detailed progress per challenge
- Familiar tab pattern

**Cons:**
- Requires taps to see all goals
- Less glanceable than single unified view

---

#### Conflict Resolution: Overlapping Metrics

**Problem:** Two FitCircles both require daily step tracking with different targets
- Weight Loss FitCircle: 10,000 steps/day
- Step Challenge FitCircle: 12,000 steps/day

**Solution:**
1. **Use highest step goal:** 12,000 steps/day
   - Dashboard shows: "12,000 steps/day (for both FitCircles)"
   - Logging 12k steps counts toward both challenges

2. **Partial credit:**
   - If user logs 10,500 steps:
     - Weight Loss FitCircle: ✓ Goal complete (105%)
     - Step Challenge: ⬤ Partial (87.5%)

3. **Transparent attribution:**
   - When user completes step goal, show:
     - "✓ 12,000 steps logged"
     - "Counts toward: Weight Loss + Steps Challenge"

---

## 3. UX/UI Recommendations

### 3.1 Dashboard Circle Behavior (Detailed)

#### Animation & Micro-Interactions

**1. Ring Fill Animation**
- **Trigger:** User logs progress (e.g., updates steps from 5,000 → 8,000)
- **Animation:**
  - Ring fills smoothly over 0.8s (ease-out curve)
  - Glow effect intensifies as ring approaches 100%
  - At 100%, ring "locks closed" with satisfying snap + haptic
- **Code suggestion:**
  ```typescript
  <motion.circle
    strokeDashoffset={strokeDashoffset}
    animate={{ strokeDashoffset: newOffset }}
    transition={{ duration: 0.8, ease: "easeOut" }}
  />
  ```

**2. Goal Completion Celebration**
- **Trigger:** All daily goals complete (all rings at 100%)
- **Animation sequence:**
  1. Rings pulse/glow (0.3s)
  2. Confetti burst from center (1.5s) - use `react-confetti` or Framer Motion particles
  3. Success toast slides in from top (0.5s)
  4. XP counter animates (+25 XP)
  5. Streak counter updates with flame animation
- **Sound:** Optional "ding" or "chime" (iOS-style success sound)

**3. Hover/Tap Interactions**
- **Desktop hover:** Ring highlights, shows tooltip with details
  - "Steps: 8,234 / 10,000 (82%) - 1,766 to go!"
- **Mobile tap:** Circle expands to show detailed breakdown
  - Modal or sheet with:
    - Today's progress timeline
    - Historical trend (7-day sparkline)
    - Adjust goal button

**4. Drag-to-Refresh**
- **Mobile gesture:** Pull down on dashboard to refresh today's stats
- **Animation:** Circular loading spinner inside main circle
- **Haptic feedback:** Light tap when data refreshes

---

### 3.2 Labels, Copy, and Messaging

#### Tone: Encouraging, Not Judgmental

**Daily Goal Status Messages:**

✅ **When user is on track:**
- "You're crushing it today! 🔥"
- "Keep this momentum going!"
- "You've completed daily goals 5 days in a row!"

⚠️ **When user is behind:**
- "You've got this! Just 2,000 more steps to hit your goal."
- "No rush - you have until midnight to close your rings."
- "Small progress is still progress! Every step counts."

❌ **When user missed goal:**
- "That's okay! Let's focus on today."
- "You've hit your goal 5 of 7 days this week - that's 71%!"
- "Missing one day doesn't erase your progress. Keep going!"

🎉 **Celebration messages:**
- "🎉 All goals complete! You're a champion!"
- "Boom! You just closed all your rings!"
- "Another day, another victory! Share it with your FitCircle?"

---

#### Button Labels

**Goal Setting:**
- "Set My Daily Goals" (clear, action-oriented)
- NOT: "Configure goals" (too technical)

**Editing Goals:**
- "Adjust Goals" (implies flexibility)
- NOT: "Change goals" (sounds like giving up)

**Completion:**
- "Log Progress" (active voice)
- NOT: "Update data" (passive, boring)

**Sharing:**
- "Share with FitCircle" (social context)
- "Post to Feed" (alternative)
- NOT: "Share" (too generic)

---

#### Tooltips & Helper Text

**On hover/tap of dashboard circle:**
- "Your daily goal progress. Tap to see details."

**First-time user (no goals set):**
- "Set daily goals to track your FitCircle progress automatically."

**Goal recommendations:**
- "Based on your 10 lb weight loss goal in 8 weeks, we recommend:"
- [Show calculation transparency - see section 2.2]

**Adaptive goal suggestions:**
- "You've beaten your step goal 6 of 7 days! Ready to level up to 11,000 steps?"
- "You've missed your goal 3 times this week. Lower to 7,500 steps to rebuild momentum?"

---

### 3.3 Visual Hierarchy: Daily vs Long-Term Progress

**Challenge:** Users need to see both daily progress (Did I hit my goal today?) AND long-term progress (How close am I to winning my FitCircle?).

**Solution: Two-Tier Visual Hierarchy**

#### Tier 1: Daily Progress (Dashboard Top - Primary Focus)

**Location:** Top 1/3 of dashboard (above the fold)

**Components:**
1. **Main progress circle** (200-280px diameter)
   - Shows TODAY'S daily goal progress
   - Color: Bright, saturated colors (indigo, purple, orange)
   - Label: "Today's Goals" or "Daily Progress"

2. **Quick summary cards**
   - Steps today: "8,234 / 10,000"
   - Weight logged: "✓ 172.3 lbs"
   - Streak: "🔥 5 days"

**Design emphasis:**
- Largest visual element on page
- Bright accent colors
- Animation/movement (ring fills, confetti)
- **User's attention drawn here first**

---

#### Tier 2: Long-Term Progress (Below Daily Circle)

**Location:** Middle section of dashboard (requires scroll on mobile)

**Components:**
1. **FitCircle challenge cards** (one per active FitCircle)
   - Title: "Weight Loss FitCircle: Team Lightning"
   - Overall progress: "65% complete" (percentage toward challenge end goal)
   - Days remaining: "14 days left"
   - Team rank: "#3 of 10 teams"
   - Individual rank: "#2 in your team"

2. **Long-term trend graphs**
   - Weight over time (14-day chart)
   - Steps per day (bar chart)
   - Overall challenge trajectory vs target

**Design de-emphasis:**
- Smaller components (cards vs main circle)
- Muted colors (gray text, subtle gradients)
   - Less animation (static graphs, subtle hover effects)
- **User scrolls to see these - secondary priority**

---

#### Visual Separation

**Use clear visual breaks:**
1. **Section headers:**
   - "Today's Goals" (bold, 24px, white)
   - "FitCircle Challenges" (bold, 20px, gray-300)

2. **Spacing:**
   - 48px margin between daily section and long-term section
   - Creates clear visual hierarchy

3. **Background cards:**
   - Daily progress: Darker card (slate-900/50 with glow)
   - Long-term progress: Lighter cards (slate-800/30, less prominent)

---

#### Mobile vs Desktop Hierarchy

**Mobile (Vertical Scroll):**
```
┌─────────────────────┐
│  Header             │
│  "Welcome back!"    │
├─────────────────────┤
│  DAILY PROGRESS     │  ← Above fold
│  [Main Circle]      │    (main focus)
│  [Quick Summary]    │
├─────────────────────┤  ← Fold line
│  [Stats Grid]       │  ← Scroll to see
│  [Weight Chart]     │
├─────────────────────┤
│  FITCIRCLE PROGRESS │  ← Further scroll
│  [Challenge Cards]  │
│  [Leaderboards]     │
└─────────────────────┘
```

**Desktop (Side-by-Side):**
```
┌──────────────────────────────────────┐
│  Header: "Welcome back, John!"       │
├──────────────────────────────────────┤
│           │                          │
│  DAILY    │   LONG-TERM             │
│  PROGRESS │   PROGRESS              │
│           │                          │
│  [Main    │   [Weight Chart ───→]   │
│   Circle] │   [Steps Chart  ───→]   │
│           │                          │
│  [Quick   │   [FitCircle Cards]     │
│   Stats]  │   - Weight Loss (65%)   │
│           │   - Steps (82%)         │
│           │                          │
│  2/3 width│   1/3 width             │
└──────────────────────────────────────┘
```

**Desktop Advantage:**
- User sees both daily AND long-term at once
- No scrolling required
- More screen real estate for data visualization

---

### 3.4 Micro-Interactions and Animations

**Principle:** Animations should **delight without distracting**, provide **feedback**, and **reduce perceived wait time**.

#### 1. Ring Fill Animation (Core Interaction)

**Trigger:** User logs progress (steps, weight, etc.)

**Animation:**
- Stroke-dashoffset animated from current → new value
- Duration: 0.8-1.2s (slower = more satisfying for big jumps)
- Easing: `ease-out` (starts fast, ends slow)
- Accompanied by:
  - Number counter animating (e.g., 5,000 → 8,234 steps)
  - Glow pulse when ring reaches 100%

**Code snippet (Framer Motion):**
```tsx
<motion.circle
  stroke="#6366f1"
  strokeDasharray={circumference}
  strokeDashoffset={strokeDashoffset}
  animate={{ strokeDashoffset: newOffset }}
  transition={{
    duration: 1,
    ease: [0.25, 0.1, 0.25, 1] // Custom ease-out
  }}
/>
```

---

#### 2. Confetti Celebration

**Trigger:** All daily goals completed

**Animation:**
- Confetti particles burst from circle center
- 100-150 particles, randomized colors (indigo, purple, orange, green)
- Physics: Particles arc outward, fall with gravity
- Duration: 2.5s, then fade out
- Layer: Overlays entire dashboard (z-index: 1000)

**Implementation:**
- Use `react-confetti` library or custom Framer Motion particle system
- Confetti should feel "premium" (smooth 60fps animation)

**Code snippet:**
```tsx
import Confetti from 'react-confetti';

{showConfetti && (
  <Confetti
    width={windowWidth}
    height={windowHeight}
    recycle={false}
    numberOfPieces={150}
    colors={['#6366f1', '#8b5cf6', '#f97316', '#10b981']}
    onConfettiComplete={() => setShowConfetti(false)}
  />
)}
```

---

#### 3. Number Counter Animation

**Trigger:** Stats update (steps increase, weight changes)

**Animation:**
- Numbers "roll up" like an odometer
- Duration: 0.6s
- Easing: `ease-out`
- Accompanies ring fill animation

**Implementation:**
```tsx
<motion.span
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6, ease: "easeOut" }}
>
  {animatedValue}
</motion.span>
```

---

#### 4. Goal Completion Glow

**Trigger:** Ring reaches 100%

**Animation:**
- Ring stroke adds glowing box-shadow
- Glow pulses 3 times (grow → shrink → grow → shrink → grow → fade)
- Duration: 1.5s total
- Color: Matches ring color (indigo/purple/orange)

**CSS/Framer Motion:**
```tsx
<motion.circle
  stroke="#6366f1"
  animate={{
    filter: [
      'drop-shadow(0 0 0px #6366f1)',
      'drop-shadow(0 0 20px #6366f1)',
      'drop-shadow(0 0 10px #6366f1)',
      'drop-shadow(0 0 20px #6366f1)',
      'drop-shadow(0 0 0px #6366f1)',
    ]
  }}
  transition={{ duration: 1.5, times: [0, 0.25, 0.5, 0.75, 1] }}
/>
```

---

#### 5. Streak Flame Animation

**Trigger:** Streak counter increases

**Animation:**
- Flame icon 🔥 bounces/scales up briefly
- Duration: 0.5s
- Easing: `spring` (bouncy feel)
- Accompanied by orange glow

**Framer Motion:**
```tsx
<motion.div
  animate={{ scale: [1, 1.3, 1] }}
  transition={{ duration: 0.5, ease: "anticipate" }}
>
  🔥 {streakDays} days
</motion.div>
```

---

#### 6. Pull-to-Refresh

**Trigger:** User pulls down on dashboard (mobile)

**Animation:**
- Circular loading spinner appears inside main circle
- Spinner rotates (360deg loop)
- When data loads: Spinner fades out, circle re-animates

**Implementation:**
- Use `react-spring` or native CSS `@keyframes`
- Spinner should match FitCircle brand colors

---

#### 7. Hover States (Desktop)

**Trigger:** Mouse hovers over dashboard circle or stat card

**Animation:**
- Card scales up slightly (1 → 1.02)
- Box-shadow intensifies (subtle lift effect)
- Border glow (accent color)
- Cursor: pointer

**CSS:**
```css
.stat-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.stat-card:hover {
  transform: scale(1.02);
  box-shadow: 0 20px 40px rgba(99, 102, 241, 0.3);
}
```

---

### 3.5 Color Coding (Dark Mode with Bright Accents)

FitCircle uses **forced dark mode** with vibrant accent colors. Daily Progress Meter should follow this system:

#### Color Palette

**Background Layers:**
- Base: `slate-950` (#020617)
- Secondary: `slate-900` (#0f172a)
- Cards: `slate-900/50` (50% opacity, glass-morphism)

**Accent Colors (Metric-Specific):**

1. **Steps: Indigo**
   - Ring: `#6366f1` (indigo-500)
   - Glow: `#6366f1` with 30% opacity
   - Text: `indigo-400` for labels
   - Usage: Step counter, step goal ring

2. **Weight: Purple**
   - Ring: `#8b5cf6` (purple-500)
   - Glow: `#8b5cf6` with 30% opacity
   - Text: `purple-400` for labels
   - Usage: Weight logging ring, weight chart

3. **Streak: Orange**
   - Ring: `#f97316` (orange-500)
   - Glow: `#f97316` with 30% opacity
   - Text: `orange-400` for labels
   - Icon: 🔥 flame
   - Usage: Streak counter, consistency metrics

4. **Success States: Green**
   - Checkmarks: `#10b981` (green-500)
   - Completion status: `green-400`
   - Usage: Completed goal indicators

5. **Warning/Incomplete: Yellow**
   - Partial progress: `#fbbf24` (yellow-500)
   - Usage: Goals in progress but behind schedule

6. **Neutral: Gray**
   - Inactive states: `gray-500`
   - Disabled: `gray-600`
   - Secondary text: `gray-400`

---

#### Color Usage Rules

**Main Dashboard Circle:**
- If single metric: Use metric's color (indigo for steps, purple for weight)
- If dual rings: Outer = indigo (steps), Inner = purple (weight)
- If 3+ rings: Add orange (streak) as third concentric ring

**Background Glow:**
- Match ring color at 5-10% opacity
- Creates subtle depth without overwhelming

**Text Hierarchy:**
- Primary (metric values): `white`
- Secondary (labels): `gray-300`
- Tertiary (helper text): `gray-400`

**Charts:**
- Line charts: Use metric color (purple for weight, indigo for steps)
- Gradient fill: Metric color at 40% opacity → 0% opacity
- Grid lines: `slate-700` (subtle, don't compete with data)

---

#### Accessibility Considerations

**Color Contrast (WCAG AA Compliance):**
- All accent colors on dark backgrounds meet 4.5:1 contrast ratio
- Indigo-400 on slate-950: ✓ 7.2:1
- Purple-400 on slate-950: ✓ 6.8:1
- Orange-400 on slate-950: ✓ 8.1:1

**Color-Blind Friendly:**
- Don't rely on color alone for status
- Use icons + text labels:
  - ✓ (checkmark) for complete
  - ⬤ (circle) for in progress
  - Numbers always shown alongside colors

**Dark Mode Only:**
- No light mode toggle (forced dark per CLAUDE.md)
- Reduces design complexity
- Aligns with "premium fitness app" aesthetic

---

## 4. Data Model Requirements

### 4.1 New Database Tables

Based on current schema analysis, we need to extend the following:

#### Extend Existing `profiles` Table

**Current structure:**
- `id` (UUID, PK)
- `email`, `username`, `display_name`, `avatar_url`
- `goals` (JSONB) ← **Extend this**

**Proposed `goals` JSONB schema enhancement:**

```typescript
// Current goals structure (from codebase analysis):
interface Goal {
  type: 'weight' | 'steps' | 'workout' | 'custom';
  target_weight_kg?: number;
  starting_weight_kg?: number;
  daily_steps_target?: number;
  // Add new fields:
  daily_goal?: number;  // Daily target (steps, weight change, etc.)
  goal_frequency?: 'daily' | 'weekly' | 'flexible';
  reminder_time?: string; // ISO time "09:00:00" for morning reminder
  adaptive_goals_enabled?: boolean; // Allow system to adjust goals
  last_auto_adjustment?: string; // ISO timestamp
}
```

**Migration:** No schema change needed - JSONB allows adding fields without migration.

---

#### Extend Existing `daily_tracking` Table

**Current structure:**
```sql
CREATE TABLE daily_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  tracking_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg DECIMAL(10,2),
  steps INTEGER,
  mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 10),
  energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tracking_date)
);
```

**Add new columns:**

```sql
ALTER TABLE daily_tracking
ADD COLUMN daily_goal_steps INTEGER, -- Daily step goal on this date
ADD COLUMN daily_goal_weight_kg DECIMAL(10,2), -- Daily weight log goal (for weight loss challenges)
ADD COLUMN goal_completion_status JSONB; -- Track which goals were completed
```

**`goal_completion_status` JSONB structure:**
```json
{
  "steps_goal_met": true,
  "weight_logged": true,
  "mood_logged": true,
  "energy_logged": false,
  "overall_completion": 0.75,  // 75% of goals completed
  "completed_at": "2025-10-25T14:32:00Z"  // When all goals were met
}
```

**Why JSONB?**
- Flexible: Can add new goal types without schema changes
- Queryable: Can filter by goal completion in PostgreSQL
- Future-proof: Supports custom challenge goal types

---

#### New Table: `daily_goals`

**Purpose:** Track daily goal configurations tied to FitCircle challenges

```sql
CREATE TABLE daily_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE, -- Null if personal goal

  -- Goal definition
  goal_type TEXT NOT NULL CHECK (goal_type IN ('steps', 'weight_log', 'workout', 'custom')),
  target_value DECIMAL(10,2), -- Daily target (e.g., 10000 steps)
  unit TEXT, -- 'steps', 'kg', 'lbs', 'minutes', etc.

  -- Scheduling
  start_date DATE NOT NULL,
  end_date DATE, -- Null = ongoing
  frequency TEXT CHECK (frequency IN ('daily', 'weekdays', 'weekends', 'custom')),
  custom_schedule JSONB, -- For custom frequency (e.g., Mon/Wed/Fri only)

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false, -- Primary goal shows in main dashboard circle

  -- Auto-adjustment
  auto_adjust_enabled BOOLEAN DEFAULT false,
  baseline_value DECIMAL(10,2), -- User's baseline (e.g., avg 6k steps/day)
  adjustment_algorithm TEXT, -- 'fitbit_incremental', 'percentage_based', etc.
  last_adjusted_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, challenge_id, goal_type) -- One goal per user per challenge per type
);

CREATE INDEX idx_daily_goals_user ON daily_goals(user_id) WHERE is_active = true;
CREATE INDEX idx_daily_goals_challenge ON daily_goals(challenge_id);
CREATE INDEX idx_daily_goals_primary ON daily_goals(user_id, is_primary) WHERE is_active = true;
```

**Usage:**
- When user joins FitCircle, system auto-creates `daily_goals` entry
- `goal_type` and `target_value` calculated from challenge parameters (see Section 2.2)
- User can override auto-calculated values via "Adjust Goals" UI

---

#### New Table: `goal_completion_history`

**Purpose:** Track daily goal completion for analytics and streak calculation

```sql
CREATE TABLE goal_completion_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  daily_goal_id UUID REFERENCES daily_goals(id) ON DELETE CASCADE,
  completion_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Completion data
  target_value DECIMAL(10,2), -- Goal target on this day
  actual_value DECIMAL(10,2), -- What user actually logged
  completion_percentage DECIMAL(5,2), -- 0-100+ (can exceed 100%)
  is_completed BOOLEAN GENERATED ALWAYS AS (completion_percentage >= 100) STORED,

  -- Timing
  completed_at TIMESTAMPTZ, -- When user hit 100% (for measuring time-to-goal)
  logged_at TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata
  notes TEXT, -- User notes (e.g., "Felt great today!")
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, daily_goal_id, completion_date)
);

CREATE INDEX idx_goal_completion_user_date ON goal_completion_history(user_id, completion_date DESC);
CREATE INDEX idx_goal_completion_streak ON goal_completion_history(user_id, is_completed) WHERE is_completed = true;
```

**Usage:**
- Every time user logs progress, upsert into this table
- Use for:
  - Streak calculation (consecutive days where `is_completed = true`)
  - Analytics (avg completion %, best day of week, etc.)
  - Weekly digests (7-day rolling completion rate)

---

### 4.2 How Daily Goals Relate to FitCircle Challenges

**Data Flow:**

1. **User joins FitCircle challenge**
   - `POST /api/challenges/{id}/join`
   - Service layer:
     ```typescript
     // After creating challenge_participants entry:
     await DailyGoalService.createDailyGoalsForChallenge(userId, challengeId);
     ```

2. **Service calculates daily goals**
   - Read challenge: type (weight_loss, steps, workout), start/end dates, target
   - Calculate daily target (see Section 2.2 formulas)
   - Insert into `daily_goals` table:
     ```sql
     INSERT INTO daily_goals (user_id, challenge_id, goal_type, target_value, start_date, end_date)
     VALUES ($1, $2, 'steps', 10000, '2025-10-25', '2025-12-20');
     ```

3. **User logs daily progress**
   - `POST /api/check-ins` (existing endpoint)
   - Service layer:
     ```typescript
     // After inserting into daily_tracking:
     await DailyGoalService.updateGoalCompletion(userId, date, { steps: 8234 });
     ```

4. **System calculates completion**
   - Read `daily_goals` for user
   - Compare logged values to target values
   - Upsert into `goal_completion_history`:
     ```sql
     INSERT INTO goal_completion_history (user_id, daily_goal_id, completion_date, target_value, actual_value, completion_percentage)
     VALUES ($1, $2, CURRENT_DATE, 10000, 8234, 82.34)
     ON CONFLICT (user_id, daily_goal_id, completion_date)
     DO UPDATE SET actual_value = 8234, completion_percentage = 82.34;
     ```

5. **Dashboard queries completion data**
   - `GET /api/daily-goals/progress`
   - Returns:
     ```json
     {
       "today": {
         "steps": { "target": 10000, "actual": 8234, "percentage": 82.34, "completed": false },
         "weight_log": { "completed": true },
         "overall": { "completed": 1, "total": 2, "percentage": 50 }
       },
       "streak": 5,
       "challenge_progress": {
         "weight_loss_fitcircle": { "overall_percentage": 65, "days_remaining": 14 }
       }
     }
     ```

---

### 4.3 Historical Data Considerations

**Problem:** Users might join FitCircle mid-challenge or want to backfill data.

#### Backfilling Daily Goals

**Scenario:** User joins 8-week weight loss challenge on Week 3.

**Solution:**
1. **Retroactive goal creation**
   - Create `daily_goals` entry with `start_date` = challenge start date (2 weeks ago)
   - User can backfill data via "Log past date" dialog (already exists in dashboard)

2. **Partial credit for past days**
   - If user backfills weight logs for past 14 days:
     - System calculates completion % for each past day
     - Inserts into `goal_completion_history` with `logged_at` = now, but `completion_date` = past date
     - Streak calculation ignores backfilled data (only counts prospective logging)

3. **Challenge progress calculation**
   - FitCircle overall progress uses **all** logged data (backfilled + prospective)
   - Daily goal completion badges only count prospective logging

---

#### Data Retention

**How long to keep historical data?**

**Recommendation:**
- `daily_tracking`: Keep forever (user's personal health data)
- `goal_completion_history`: Keep for 1 year, then archive
  - After challenge ends, historical completion data less relevant
  - Archive to separate table (`goal_completion_archive`) for analytics
- `daily_goals`: Soft-delete (`is_active = false`) when challenge ends
  - Allows re-activation if user rejoins similar challenge

**Storage impact:**
- `goal_completion_history`: ~365 rows per user per year
- With 100K users: 36.5M rows/year
- At ~200 bytes/row: ~7.3 GB/year (manageable with PostgreSQL partitioning)

---

#### Analytics Queries

**Common queries we'll need:**

1. **User's current streak:**
   ```sql
   WITH RECURSIVE streak_calc AS (
     SELECT completion_date, is_completed,
            ROW_NUMBER() OVER (ORDER BY completion_date DESC) as rn
     FROM goal_completion_history
     WHERE user_id = $1 AND is_completed = true
     ORDER BY completion_date DESC
   )
   SELECT COUNT(*) as streak
   FROM streak_calc
   WHERE rn = completion_date - (SELECT MIN(completion_date) FROM streak_calc)
   ```

2. **Weekly completion rate:**
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE is_completed) / COUNT(*)::DECIMAL as completion_rate
   FROM goal_completion_history
   WHERE user_id = $1
     AND completion_date >= CURRENT_DATE - INTERVAL '7 days'
   ```

3. **Best day of week for goal completion:**
   ```sql
   SELECT
     EXTRACT(DOW FROM completion_date) as day_of_week,
     AVG(completion_percentage) as avg_completion
   FROM goal_completion_history
   WHERE user_id = $1
   GROUP BY day_of_week
   ORDER BY avg_completion DESC
   ```

**Optimization:**
- Create materialized view for streak calculation (refresh daily)
- Index on `(user_id, completion_date DESC)` for recent data queries

---

## 5. Success Metrics & Measurement

### 5.1 North Star Metric

**Primary Metric:** **Daily Active Goal Completers (DAGC)**

**Definition:** Number of users who complete ALL their daily goals on a given day.

**Target:**
- **Week 1:** 35% of DAU complete all daily goals
- **Week 4:** 50% of DAU complete all daily goals
- **Week 12:** 60% of DAU complete all daily goals

**Why this metric?**
- Strong correlation with retention (users who complete daily goals stick around)
- Indicates feature adoption and engagement
- Ladders up to challenge completion (users who hit daily goals win challenges)

---

### 5.2 Key Performance Indicators (KPIs)

#### Engagement Metrics

1. **Daily Active Users (DAU)**
   - **Current Baseline:** (TBD - need to measure before launch)
   - **Target:** +40% increase within 30 days of feature launch
   - **Measurement:** Count of users who log at least one metric per day

2. **Daily Goal Completion Rate**
   - **Definition:** % of days where user completes all daily goals
   - **Target:** 65% overall completion rate
   - **Measurement:**
     ```sql
     SELECT AVG(CASE WHEN overall_completion = 1.0 THEN 1 ELSE 0 END)
     FROM goal_completion_history
     WHERE completion_date >= CURRENT_DATE - 30
     ```

3. **Average Goals per User**
   - **Target:** 2.5 active daily goals per user
   - **Indicates:** Multi-FitCircle participation

4. **Time to First Goal Completion**
   - **Target:** <24 hours from goal setup to first completion
   - **Indicates:** Onboarding effectiveness

---

#### Retention Metrics

5. **D1 Retention (Daily Goal Completers)**
   - **Definition:** % of users who complete goals on Day 1 and return on Day 2
   - **Target:** 55% (vs 40% overall D1 retention)
   - **Hypothesis:** Users who complete daily goals have higher retention

6. **D7 Retention (Daily Goal Completers)**
   - **Target:** 35% (vs 25% overall D7 retention)
   - **Measurement:** Cohort analysis of users who complete goals in first week

7. **Streak Length Distribution**
   - **Target:**
     - 40% of users achieve 7-day streak within first month
     - 20% achieve 14-day streak
     - 10% achieve 30-day streak
   - **Indicates:** Habit formation success

---

#### Challenge Impact Metrics

8. **Challenge Completion Rate (with Daily Goals)**
   - **Target:** 75% of users with daily goals complete their FitCircle challenges
   - **Comparison:** Measure vs users without daily goals (control group)
   - **Hypothesis:** Daily goals increase challenge completion by 15-20%

9. **Average Progress per Week (Challenge Participants)**
   - **Target:** Users with daily goals progress 15% faster toward challenge targets
   - **Measurement:** Compare weekly progress rate of daily goal users vs non-users

---

#### Behavioral Metrics

10. **Daily Check-In Frequency**
    - **Current:** Users check in ~3-4x/week (estimate)
    - **Target:** 6x/week with daily goals feature
    - **Measurement:** Avg check-ins per user per week

11. **Session Duration**
    - **Target:** +20% increase in avg session time
    - **Hypothesis:** Users spend more time reviewing progress, adjusting goals

12. **Share Rate (Goal Completions)**
    - **Target:** 15% of daily goal completions shared to FitCircle feed
    - **Indicates:** Social engagement and virality

---

#### Business Metrics

13. **Conversion to Paid (Pro Subscription)**
    - **Hypothesis:** Users who complete daily goals are 2x more likely to convert to Pro
    - **Target:** 20% conversion rate (vs 10% baseline)
    - **Reason:** Daily goals demonstrate value, users want advanced features

14. **Customer Lifetime Value (LTV)**
    - **Target:** +25% LTV for daily goal users
    - **Reason:** Higher retention = more subscription months

---

### 5.3 A/B Testing Recommendations

#### Test 1: Daily Goal Onboarding Flow

**Hypothesis:** Users who set daily goals during challenge join have higher completion rates.

**Variants:**
- **Control (A):** No daily goal setup prompt (current behavior)
- **Variant B:** Modal prompt: "Set daily goals?" after challenge join
- **Variant C:** Forced onboarding: "Let's set your daily goals" (required step)

**Primary Metric:** D7 retention
**Secondary Metrics:** Daily goal completion rate, challenge completion rate

**Sample Size:** 5,000 users per variant (15,000 total)
**Duration:** 30 days
**Expected Lift:** 10-15% improvement in D7 retention for Variant C

---

#### Test 2: Daily Goal Visualization Style

**Hypothesis:** Apple Fitness-style activity rings outperform single circular progress meter.

**Variants:**
- **Control (A):** Single circular progress bar (current dashboard circle)
- **Variant B:** Dual concentric rings (steps outer, weight inner)
- **Variant C:** Triple rings (steps, weight, streak)

**Primary Metric:** Daily goal completion rate
**Secondary Metrics:** Session duration, feature engagement

**Sample Size:** 3,000 users per variant (9,000 total)
**Duration:** 21 days
**Expected Lift:** 5-10% increase in completion rate for multi-ring design

---

#### Test 3: Goal Completion Celebration

**Hypothesis:** Confetti + social share prompt increases repeat completions.

**Variants:**
- **Control (A):** Toast notification only ("Goals complete!")
- **Variant B:** Confetti animation + toast
- **Variant C:** Confetti + toast + social share prompt ("Share with FitCircle?")

**Primary Metric:** Share rate
**Secondary Metrics:** Next-day goal completion (does celebration drive repeat behavior?)

**Sample Size:** 2,000 users per variant (6,000 total)
**Duration:** 14 days
**Expected Lift:** 3x increase in share rate for Variant C

---

#### Test 4: Adaptive Goal Recommendations

**Hypothesis:** System-suggested goal adjustments improve completion rates vs static goals.

**Variants:**
- **Control (A):** Static daily goals (user sets once, never changes)
- **Variant B:** Weekly recommendation prompts ("Increase to 11k steps?")
- **Variant C:** Auto-adjustment (system adjusts goals based on performance)

**Primary Metric:** Goal completion rate
**Secondary Metrics:** User satisfaction (survey), streak length

**Sample Size:** 4,000 users per variant (12,000 total)
**Duration:** 60 days (need longer period to see adaptation effects)
**Expected Lift:** 8-12% improvement in completion rate for adaptive variants

---

### 5.4 Measurement Implementation

#### Analytics Event Tracking

**Required Events (via Segment/Mixpanel/Amplitude):**

```typescript
// Goal Setup
analytics.track('Daily Goal Created', {
  user_id: userId,
  challenge_id: challengeId,
  goal_type: 'steps',
  target_value: 10000,
  is_auto_generated: true,
  is_primary: true
});

// Daily Progress Logging
analytics.track('Daily Goal Progress Updated', {
  user_id: userId,
  goal_id: goalId,
  date: '2025-10-25',
  target_value: 10000,
  actual_value: 8234,
  completion_percentage: 82.34,
  is_completed: false
});

// Goal Completion
analytics.track('Daily Goal Completed', {
  user_id: userId,
  goal_id: goalId,
  goal_type: 'steps',
  completion_time: '14:32:00', // Time of day completed
  days_in_streak: 5,
  time_to_completion_hours: 9.5 // Hours since midnight
});

// All Daily Goals Complete
analytics.track('All Daily Goals Completed', {
  user_id: userId,
  date: '2025-10-25',
  total_goals: 3,
  completion_time: '18:45:00',
  confetti_shown: true,
  share_prompted: true,
  shared_to_feed: false
});

// Goal Adjustment
analytics.track('Daily Goal Adjusted', {
  user_id: userId,
  goal_id: goalId,
  old_target: 10000,
  new_target: 8500,
  adjustment_reason: 'user_manual', // or 'system_recommendation'
  performance_last_7_days: 0.67 // 67% completion rate
});

// Streak Milestones
analytics.track('Streak Milestone Reached', {
  user_id: userId,
  streak_length: 7,
  milestone_type: 'week_warrior',
  badge_unlocked: true
});
```

---

#### Dashboard for Product Team

**Key Views:**

1. **Daily Goal Completion Funnel**
   - Users with daily goals set (total)
   - Users who logged progress today (% of total)
   - Users who completed all goals (% of loggers)
   - Users who shared completion (% of completers)

2. **Retention Cohorts**
   - Compare retention curves:
     - Users with daily goals vs without
     - Users who complete goals consistently (>70% rate) vs inconsistently (<40%)

3. **Goal Type Breakdown**
   - Which goal types have highest completion rates?
     - Steps: 72%
     - Weight logging: 85%
     - Workouts: 58%
     - Mood/energy: 45%

4. **Time-of-Day Heatmap**
   - When do users complete goals?
   - Morning (6-9am): 35% of weight logs
   - Evening (6-9pm): 55% of step goals
   - Inform optimal notification timing

5. **Streak Distribution**
   - Histogram: How many users at each streak length?
   - Churn analysis: At what streak length do users drop off? (Hypothesis: 7-10 day danger zone)

---

## 6. Implementation Roadmap & Prioritization

### 6.1 MVP (Must-Have for Launch)

**Goal:** Ship functional daily goal system that integrates with FitCircle challenges.

**Timeline:** 3-4 weeks (1 sprint)

**Features:**

#### Week 1: Data Model & Backend
- [ ] Create `daily_goals` table migration
- [ ] Create `goal_completion_history` table migration
- [ ] Extend `daily_tracking` schema (add goal completion fields)
- [ ] Build `DailyGoalService` (TypeScript service layer)
  - `createDailyGoalsForChallenge(userId, challengeId)`
  - `calculateDailyTargets(challengeType, params)` (implements formulas from Section 2.2)
  - `updateGoalCompletion(userId, date, loggedData)`
  - `getStreakForUser(userId)`
- [ ] Create API endpoints:
  - `GET /api/daily-goals` - Fetch user's active daily goals
  - `GET /api/daily-goals/progress` - Get today's progress
  - `POST /api/daily-goals` - Create/update daily goals
  - `PATCH /api/daily-goals/{id}` - Adjust goal target
  - `GET /api/daily-goals/streak` - Get current streak

#### Week 2: Frontend - Dashboard Circle
- [ ] Update dashboard circle component (`CircularProgress`)
  - Support dual-ring mode (steps + weight logging)
  - Animate ring fill on progress updates
  - Show completion percentage in center
- [ ] Build goal completion summary below circle
  - ✓ Checkmarks for completed goals
  - ⬤ Progress indicators for in-progress goals
  - Streak counter with flame icon
- [ ] Integrate with existing quick-entry cards
  - On weight/steps submit, update goal completion
  - Show real-time ring fill animation
- [ ] Add goal setup flow
  - Modal: "Set Your Daily Goals" (triggered on first challenge join)
  - Show calculated recommendations + allow customization
  - Save to `daily_goals` table

#### Week 3: Goal Completion & Celebrations
- [ ] Build goal completion detection logic
  - Check if all daily goals at 100%
  - Trigger celebration sequence
- [ ] Implement celebration animations
  - Confetti burst (using `react-confetti`)
  - Ring glow + pulse animation
  - Success toast notification
  - XP counter animation (+25 XP)
- [ ] Add social sharing
  - "Share with FitCircle" button on completion
  - Post to FitCircle feed: "User closed their rings! 🔥"
- [ ] Streak calculation
  - Count consecutive days of goal completion
  - Display on dashboard
  - Award streak badges (7, 14, 30 days)

#### Week 4: Multi-Goal Support & Polish
- [ ] Support multiple active FitCircles
  - Primary/secondary goal selection UI
  - Tabbed view or stacked cards for multiple goals
  - Handle overlapping metrics (use highest target)
- [ ] Add goal adjustment UI
  - "Adjust Goals" button in dashboard
  - Show performance last 7 days (% completion)
  - Suggest adaptive changes
- [ ] Testing & bug fixes
  - Unit tests for goal calculation logic
  - Integration tests for API endpoints
  - Visual regression tests for dashboard circle
- [ ] Analytics instrumentation
  - Add event tracking (see Section 5.4)
  - Set up dashboards for PM/eng team

**Success Criteria for MVP Launch:**
- ✅ Users can set daily goals when joining FitCircle challenge
- ✅ Dashboard circle shows real-time daily goal progress
- ✅ Confetti celebration on goal completion
- ✅ Streak tracking works accurately
- ✅ Multi-goal support (up to 3 active FitCircles)
- ✅ 95%+ test coverage on backend logic
- ✅ <500ms API response time for goal progress endpoint
- ✅ Zero critical bugs in first week of launch

---

### 6.2 Phase 2 (Nice-to-Have - 4-8 Weeks Post-Launch)

**Goal:** Enhance daily goal experience with adaptive intelligence and expanded metrics.

**Features:**

#### Adaptive Goal Recommendations (Week 5-6)
- [ ] Build recommendation engine
  - Analyze user's 7-day completion rate
  - If >80% completion: Suggest 10% increase
  - If <50% completion: Suggest 15% decrease
  - Weekly prompt: "Adjust your goals?"
- [ ] Fitbit-style incremental progression
  - Start new users at conservative goals (7k steps vs 10k)
  - Auto-increase by 500 steps/week if user consistently hits target
- [ ] Day-of-week customization (Premium feature?)
  - Higher step goals on weekdays, lower on weekends
  - Custom schedule: Mon/Wed/Fri = workout days

#### Expanded Metrics (Week 7-8)
- [ ] Add workout tracking to daily goals
  - "Complete 1 workout today" checkbox
  - Integration with workout logging (if exists)
- [ ] Add water intake tracking
  - Daily goal: "8 glasses of water"
  - Simple tap-to-log interface
- [ ] Add sleep tracking (Phase 3 - requires wearable sync)

#### Social Features (Week 8)
- [ ] FitCircle daily goal leaderboard
  - "Who closed their rings today?" in FitCircle feed
  - Daily completion rate per member
- [ ] High-five/encourage teammates
  - Tap to send encouragement when someone completes goals
- [ ] Team daily goal challenges
  - "Can our FitCircle get 100% completion today?"
  - Team-wide celebration if all members complete goals

---

### 6.3 Phase 3 (Future - 3+ Months)

**Goal:** Advanced features for power users and premium differentiation.

**Features:**

#### AI-Powered Coaching (Fitzy Integration)
- [ ] Personalized daily goal recommendations from Fitzy
  - "Based on your sleep last night, take it easy today - 7k steps instead of 10k"
  - Recovery day suggestions
- [ ] Contextual coaching messages
  - Morning: "You've got 10k steps today - let's break it down: walk to lunch (3k), evening stroll (5k)..."
  - Midday check-in: "You're at 4k steps by noon - great pace!"
  - Evening: "Only 2k steps to go - you've got this!"

#### Wearable Integration
- [ ] Sync with Apple Health / Google Fit
  - Auto-populate steps, sleep, workouts from wearables
  - Real-time goal progress updates (no manual logging needed)
- [ ] Apple Watch complication (iOS native app required)
  - Show daily goal rings on watch face
  - Tap to open FitCircle app

#### Gamification Expansion
- [ ] Daily goal power-ups (Premium)
  - "Goal Freeze" - pause streak on rest days
  - "Double XP Day" - earn 2x XP for completing goals
- [ ] Collectible badges
  - Perfect Week (7/7 days)
  - Perfect Month (30/30 days)
  - Overachiever (beat goal by 50%+ for 7 days)

#### Analytics & Insights
- [ ] Personal analytics dashboard
  - Best day of week for goal completion
  - Average time to complete daily goals
  - Correlation: mood/energy vs goal completion
- [ ] Predictive insights
  - "You usually miss goals on Fridays - set a reminder?"
  - "Your step goal completion drops 20% during rainy weather - adjust?"

---

### 6.4 Phased Rollout Strategy

**Approach:** Gradual rollout to minimize risk and gather feedback.

#### Phase 1: Internal Beta (Week 1)
- **Audience:** FitCircle team + 20 trusted beta users
- **Goal:** Bug hunting, usability feedback
- **Duration:** 3-5 days
- **Success:** No critical bugs, positive qualitative feedback

#### Phase 2: Closed Beta (Week 2)
- **Audience:** 500 existing FitCircle users (selected based on high engagement)
- **Goal:** Validate retention impact, gather usage data
- **Duration:** 7 days
- **Success:**
  - 60%+ of beta users set daily goals
  - 50%+ complete goals at least once
  - No major performance issues

#### Phase 3: Soft Launch (Week 3)
- **Audience:** 50% of new FitCircle challenge joiners (random assignment)
- **Goal:** A/B test vs control group (no daily goals)
- **Duration:** 14 days
- **Success:**
  - Treatment group has 10%+ higher D7 retention
  - 65%+ daily goal completion rate
  - <2% error rate in goal calculations

#### Phase 4: Full Launch (Week 4)
- **Audience:** 100% of users
- **Announcement:**
  - In-app modal: "Introducing Daily Goals! 🎯"
  - Blog post: "How Daily Goals Help You Win FitCircle Challenges"
  - Email campaign to inactive users: "Come back and set your daily goals!"
- **Success:**
  - 70%+ of active FitCircle participants set daily goals within 7 days
  - DAU increases by 30%+
  - NPS score improves by +5 points

---

### 6.5 Engineering Estimates

**Team:** 1 Frontend Engineer + 1 Backend Engineer + 1 Designer (part-time) + 1 PM

| Component | Effort | Dependencies |
|-----------|--------|--------------|
| Database migrations | 1 day | None |
| Backend service layer | 3 days | Migrations complete |
| API endpoints | 2 days | Service layer complete |
| Dashboard circle UI | 3 days | Design mockups approved |
| Goal setup flow | 2 days | API endpoints live |
| Celebrations & animations | 2 days | Dashboard circle complete |
| Multi-goal support | 2 days | Goal setup flow complete |
| Analytics instrumentation | 1 day | All features complete |
| Testing (unit + integration) | 3 days | Parallel to development |
| QA & bug fixing | 2 days | All features complete |
| **Total:** | **21 days** | **~4 weeks (1 sprint)** |

**Buffer:** Add 20% for unknowns = 25 days total

---

### 6.6 Design Resources Needed

**Deliverables from Design Team:**

1. **Dashboard Circle Mockups** (High Priority)
   - Desktop: 1920x1080 view
   - Mobile: 375x812 (iPhone) view
   - Tablet: 768x1024 (iPad) view
   - States: No goals, in progress, completed, multiple goals

2. **Onboarding Flow** (High Priority)
   - "Set Daily Goals" modal (3-4 screens)
   - Goal recommendation explanation screen
   - Goal customization screen
   - Confirmation screen

3. **Celebration Animations** (Medium Priority)
   - Confetti particle design (colors, shapes, physics)
   - Ring glow effect spec (color, duration, easing)
   - Success toast design

4. **Multi-Goal UI** (Medium Priority)
   - Primary/secondary goal cards
   - Tabbed view (if chosen)
   - Goal switcher component

5. **Brand Assets** (Low Priority)
   - Social share graphics ("I closed my rings!")
   - Streak milestone badges (7, 14, 30 days)
   - Achievement badge designs

**Timeline:** 1 week of design work before engineering starts

---

## 7. Risk Analysis & Mitigation

### 7.1 Technical Risks

#### Risk 1: Goal Calculation Complexity

**Risk:** Daily goal calculations from challenge parameters are complex (see Section 2.2). Math errors could lead to unrealistic goals (e.g., "Walk 50,000 steps/day").

**Impact:** High - Users frustrated by impossible goals, feature abandonment

**Probability:** Medium

**Mitigation:**
- ✅ **Sanity checks in code:**
  ```typescript
  if (dailyStepGoal > 25000 || dailyStepGoal < 2000) {
    throw new Error('Invalid step goal calculation');
  }
  ```
- ✅ **Manual review during beta:** PM reviews 50 random goal calculations
- ✅ **User override:** Always allow users to adjust system-calculated goals
- ✅ **Logging:** Log all goal calculations to debug errors quickly

---

#### Risk 2: Performance (Database Query Load)

**Risk:** Dashboard loads with multiple complex queries:
- Fetch daily goals
- Fetch completion history (streak calculation)
- Fetch FitCircle challenge progress
- Real-time goal progress updates

**Impact:** Medium - Slow page loads, poor UX

**Probability:** Medium (will scale poorly without optimization)

**Mitigation:**
- ✅ **Caching:** Redis cache for streak calculation (updates daily, not real-time)
- ✅ **Materialized views:** Pre-compute streak and completion rates
- ✅ **Pagination:** Load only today's progress on initial render, lazy-load history
- ✅ **Database indexes:** Ensure indexes on `(user_id, completion_date)` (see Section 4.1)
- ✅ **Load testing:** Simulate 10K concurrent users before launch

---

#### Risk 3: Streak Calculation Bugs

**Risk:** Streak logic is tricky (timezone handling, consecutive day detection, backfilled data). Bugs could incorrectly reset streaks, frustrating users.

**Impact:** High - Streaks are motivational; losing a streak unfairly kills engagement

**Probability:** Medium

**Mitigation:**
- ✅ **Comprehensive unit tests:** Test edge cases:
  - User in different timezone
  - Daylight saving time transitions
  - Backfilled data doesn't count toward streak
  - Skipped days break streak
- ✅ **Streak recovery:** If user contacts support about lost streak, allow manual restoration
- ✅ **Grace period:** Forgive 1 missed day every 30 days (optional Premium perk)

---

### 7.2 Product Risks

#### Risk 4: Feature Overwhelm (Too Many Goals)

**Risk:** Users join 5 FitCircles, end up with 15 daily goals, feel overwhelmed, disengage.

**Impact:** High - Feature meant to improve retention backfires

**Probability:** Low-Medium

**Mitigation:**
- ✅ **Goal limit:** Max 3 active daily goals per user (force prioritization)
- ✅ **Primary goal UX:** De-emphasize secondary goals (smaller cards, collapsed by default)
- ✅ **Onboarding education:** "We recommend focusing on 1-2 FitCircles at a time"
- ✅ **Suggested consolidation:** If user has overlapping metrics (2 step goals), suggest merging

---

#### Risk 5: Unrealistic Goal Fatigue

**Risk:** Users set overly ambitious goals (influenced by social pressure or comparison), fail repeatedly, quit.

**Impact:** High - Opposite of intended retention improvement

**Probability:** Medium

**Mitigation:**
- ✅ **Conservative defaults:** Start users at achievable goals (7k steps, not 10k)
- ✅ **Success rate transparency:** Show "Most users complete 60-70% of their goals - aim for consistency, not perfection"
- ✅ **Adaptive downward adjustment:** If user misses goals 5 days in a row, auto-suggest lower target
- ✅ **Messaging:** Emphasize "progress over perfection" in all copy
- ✅ **No penalties:** Missing goals doesn't cost XP or badges (only lack of gain)

---

#### Risk 6: Low Adoption (Users Ignore Feature)

**Risk:** Users join FitCircles but don't set daily goals, feature fails to gain traction.

**Impact:** High - Wasted engineering effort, no retention impact

**Probability:** Low (forced onboarding mitigates this)

**Mitigation:**
- ✅ **Forced onboarding (A/B test):** Test variant where daily goal setup is required step after challenge join
- ✅ **Notifications:** Remind users to set goals if they join challenge without setting them
- ✅ **Value proposition:** Clearly explain "Users with daily goals are 2x more likely to win challenges"
- ✅ **Gamification:** Award 50 XP for setting first daily goal
- ✅ **Social proof:** "85% of top FitCircle winners use daily goals"

---

### 7.3 Business Risks

#### Risk 7: Cannibalization of Challenge Participation

**Risk:** Users focus so much on daily goals that they lose sight of FitCircle challenges (the core monetization driver).

**Impact:** Medium - Reduces challenge entry fees, competition engagement

**Probability:** Low

**Mitigation:**
- ✅ **Tight integration:** Daily goals are ALWAYS tied to FitCircle challenges (can't exist standalone in MVP)
- ✅ **Challenge progress visible:** Dashboard shows FitCircle overall progress alongside daily goals
- ✅ **Social reminders:** "Your FitCircle is counting on you!" messaging emphasizes team aspect
- ✅ **Challenge completion bonuses:** Unlock special badges/XP for completing FitCircle while hitting 80%+ of daily goals

---

#### Risk 8: Increased Support Load

**Risk:** Complex feature leads to user confusion, support tickets spike.

**Impact:** Medium - Support team overwhelmed, costs increase

**Probability:** Medium

**Mitigation:**
- ✅ **In-app help:** Tooltips, helper text, FAQ section in settings
- ✅ **Tutorial:** Optional walkthrough on first use ("How Daily Goals Work")
- ✅ **Support docs:** Comprehensive help articles before launch
- ✅ **Proactive notifications:** If user hasn't set goals 3 days after joining challenge, show tutorial
- ✅ **Beta feedback:** Address confusion points surfaced during beta testing

---

## 8. Appendix

### 8.1 Glossary

- **Daily Goal:** A specific, measurable target for a single day (e.g., "Walk 10,000 steps today")
- **FitCircle Challenge:** Long-term competition (e.g., "Lose 10 lbs in 8 weeks")
- **Goal Completion:** Achieving 100% of a daily goal target
- **Streak:** Consecutive days of completing all daily goals
- **Activity Ring:** Circular progress visualization (inspired by Apple Fitness)
- **Primary Goal:** The main daily goal shown in dashboard circle (if user has multiple)
- **Adaptive Goal:** Daily goal that auto-adjusts based on user performance
- **Baseline Activity:** User's average activity level before starting goal (e.g., 6k steps/day)

---

### 8.2 Open Questions (For Discussion)

1. **Should we allow users to set daily goals WITHOUT joining a FitCircle?**
   - Pro: Attracts users who want goal tracking but not social competition
   - Con: Dilutes FitCircle focus, harder to monetize
   - **Recommendation:** MVP = FitCircle-only, Phase 2 = standalone daily goals

2. **How do we handle users who game the system?** (e.g., manually inflate steps)
   - Apple Watch sync reduces this (hard to fake wearable data)
   - Photo verification for weight (already planned)
   - **Recommendation:** Trust but verify - flag outliers for manual review

3. **Should daily goals have different difficulty tiers?** (Easy, Medium, Hard)
   - Pro: Gamification, users can choose challenge level
   - Con: Complexity, risk of users always choosing Easy
   - **Recommendation:** Not in MVP, consider for Phase 3

4. **Do we charge for advanced daily goal features?** (Premium differentiation)
   - Potential Premium features:
     - Adaptive goal recommendations
     - Custom goal types
     - Day-of-week customization
     - Goal Freeze (pause streak)
   - **Recommendation:** Keep MVP features free, paywall Phase 2+ features

5. **How granular should goal timing be?** (Daily vs hourly targets)
   - E.g., "Walk 2,000 steps by noon" (mini-goals throughout day)
   - Pro: More frequent engagement, better pacing
   - Con: Notification spam, added complexity
   - **Recommendation:** Daily only for MVP, explore intraday in Phase 3

---

### 8.3 Competitive Product Screenshots (Reference)

**Note:** These would include actual screenshots in final document. Summary:

1. **Apple Fitness Rings:**
   - Three concentric rings (Move/Exercise/Stand)
   - Clean, minimal design
   - Clear completion state (ring closes)

2. **MyFitnessPal Dashboard:**
   - Calorie counter with circular progress
   - Macro breakdown (protein/carbs/fat)
   - Daily log entries below

3. **Strava Goal Progress:**
   - Bar chart for weekly/monthly goals
   - Distance/time/elevation metrics
   - Completion percentage overlay

4. **Fitbit App:**
   - Step counter with circular gauge
   - Daily goal target line
   - Weekly trend sparkline

---

### 8.4 User Research Insights (To Be Conducted)

**Recommended Research Before Launch:**

1. **User Interviews (n=15-20)**
   - **Questions:**
     - "How do you currently track fitness progress?"
     - "What motivates you to exercise daily?"
     - "Have you ever failed to complete a fitness challenge? Why?"
     - "Show wireframe: What would daily goals help you achieve?"
   - **Goal:** Validate problem/solution fit

2. **Prototype Testing (n=10)**
   - **Task:** Set up daily goals for mock FitCircle challenge
   - **Observe:** Where do users get confused? What delights them?
   - **Goal:** Identify UX improvements before build

3. **Survey (n=200+ existing users)**
   - "Would you use a daily goal feature?" (Yes/No/Maybe)
   - "What daily metrics would you track?" (Multi-select)
   - "How many FitCircles are you active in?" (Gauge multi-goal need)
   - **Goal:** Quantify demand, prioritize metrics

---

### 8.5 References & Research Sources

1. **Apple Fitness Rings:**
   - Official docs: https://www.apple.com/watch/close-your-rings/
   - HIG guidelines: https://developer.apple.com/design/human-interface-guidelines/activity-rings

2. **MyFitnessPal Data:**
   - Winter 2025 Release: https://blog.myfitnesspal.com/winter-release/
   - Study: Users logging 4+ days in Week 1 are 7x more likely to succeed

3. **Strava Goals Feature:**
   - Support docs: https://support.strava.com/hc/en-us/articles/6822535085709

4. **Fitbit Goal Recommendations:**
   - Blog: https://resoundinglyhuman.com/episodes/how-to-up-the-ante-on-your-fitbit-goals/

5. **Fitness App UX Best Practices (2025):**
   - https://www.zfort.com/blog/How-to-Design-a-Fitness-App-UX-UI-Best-Practices-for-Engagement-and-Retention
   - https://stormotion.io/blog/fitness-app-ux/

6. **Behavioral Psychology:**
   - "Atomic Habits" by James Clear (habit formation research)
   - Nielsen Norman Group: Fitness app engagement patterns (2025)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-25 | Claude (PM) | Initial specification based on user requirements and competitive research |

---

**Next Steps:**
1. Review with stakeholders (Ani + team)
2. Conduct user research (interviews + prototype testing)
3. Finalize design mockups
4. Prioritize MVP features for Sprint 1
5. Engineering kickoff meeting

**Questions?** Contact the product team or leave comments in this document.
