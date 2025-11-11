# FitCircle Onboarding Flow Design
**Version 1.1 | Last Updated: January 11, 2025**

> **v1 Launch Note:** Social login (Apple, Google) has been deferred to v2. Version 1 will launch with email-based authentication only to simplify initial implementation and reduce third-party dependencies.

---

## Executive Summary

This document presents a comprehensive, design-forward onboarding flow for FitCircle that balances conversion optimization, user education, and early engagement. Drawing from competitive analysis (particularly StepsApp's 16-screen flow), behavioral psychology principles, and FitCircle's unique positioning, this onboarding creates a frictionless path to the "aha moment" while establishing long-term engagement patterns.

### Key Design Decisions

1. **7-9 minute target completion time** - Balances thoroughness with momentum
2. **Progressive disclosure** - Core value first, advanced features later
3. **Early "aha moment"** - Meet Fitzy and see first personalized insight by Screen 5
4. **Delayed paywall** - Free tier access, upgrade prompt after experiencing value
5. **Three parallel tracks** - Optimized flows for Casey (competitive), Sarah (social), and Mike (guided)
6. **Mobile-first, PWA-optimized** - Seamless installation and offline capability
7. **Circular design language throughout** - Reinforce brand identity from first screen
8. **Skip-friendly for power users** - Quick setup option alongside detailed path

### Expected Outcomes

- **Onboarding Completion Rate:** 65% (vs 40% industry average)
- **Time to First Value:** 90 seconds (vs 3-5 minutes typical)
- **D1 Retention:** 45% (vs 25% industry average)
- **Challenge Join Rate:** 55% within first session
- **Social Connection Rate:** 35% invite friends during onboarding

---

## Flow Analysis: Learning from StepsApp

### What Works Well in StepsApp's Flow

#### ✅ Strengths to Adapt

1. **Simple Login Flow (Screen 1-2)**
   - Minimize friction in authentication
   - **Adaptation:** Email-based authentication with clear, simple form (v1 launch - social login deferred to v2)

2. **Profile Creation Early (Screen 3-4)**
   - Avatar upload creates ownership
   - Name and bio personalize experience
   - **Adaptation:** Add quick vs detailed profile options

3. **Clear Value Proposition (Screen 8)**
   - "Never miss your goal reminder" clearly states benefit
   - **Adaptation:** Show competitive, social, and AI value props based on persona

4. **Granular Permission Control (Screen 12)**
   - Detailed health data toggles build trust
   - **Adaptation:** Group permissions logically, explain each clearly

5. **Loading States with Personality (Screen 5, 14)**
   - Reduces perceived wait time
   - **Adaptation:** Use Fitzy animations and witty copy

6. **Progressive Permission Requests (Screens 9-13)**
   - Notifications → Health → Motion asked separately with context
   - **Adaptation:** Request permissions just-in-time before features

7. **Success Confirmation (Screen 15)**
   - Celebrates setup completion
   - **Adaptation:** Trigger celebration animation + first achievement

#### ⚠️ Weaknesses to Avoid

1. **Too Many Screens (16 total)**
   - Risk: User fatigue and drop-off
   - **Fix:** Condense to 10-12 screens, combine related steps

2. **Paywall Too Early (Screen 7)**
   - Blocks value before user experiences it
   - **Fix:** Delay until after first "aha moment" or make skippable

3. **Newsletter Opt-in (Screen 4)**
   - Low-value step that adds friction
   - **Fix:** Handle in settings, not critical path

4. **No Personalization**
   - Same flow for everyone
   - **Fix:** Branch based on user goals and persona signals

5. **Limited Onboarding Value**
   - Mostly permission requests, little education
   - **Fix:** Introduce key features and show immediate value

6. **Abrupt End**
   - Setup completes, then what?
   - **Fix:** Guided first actions (log weight, join challenge, invite friend)

### What We're Doing Differently

| Aspect | StepsApp | FitCircle |
|--------|----------|-----------|
| **Focus** | Steps tracking | Multi-metric + social competition |
| **Personalization** | None | AI-driven persona detection |
| **Social** | Friend invites only | Team formation, FitCircle creation |
| **Gamification** | Basic goals | XP, levels, achievements, streaks |
| **Value Prop** | Single (step tracking) | Triple (compete, connect, coach) |
| **Monetization** | Early paywall | Free tier + delayed upgrade prompt |
| **First Action** | Goal setting | Meet Fitzy + first insight |
| **Completion Flow** | Ends at home screen | Guided first challenge join |

---

## Detailed Step-by-Step Flow

### Pre-Onboarding: Discovery & Installation

**User Entry Points:**
- Social media ad (Instagram, TikTok, Facebook)
- Friend referral link (unique invite code)
- App store organic search
- Blog/content marketing
- Web to PWA install prompt

**Installation Experience:**
```
Web → Install Prompt → PWA Icon on Home Screen
"Add FitCircle to your home screen for the full experience"
[Visual: iOS/Android installation animation]
```

---

## Screen 0: Splash Screen (Auto, 2 seconds)

### Purpose
Create anticipation, load initial assets, establish brand identity

### Visual Design

**Background:**
- Dark gradient: Slate-950 to Slate-900
- Animated circular patterns radiating outward
- Subtle particle effects suggesting movement/energy

**Center Element:**
- FitCircle logo with glowing circular rings
- Three nested circles pulsing in sequence:
  - Outer: Cyan (#06b6d4)
  - Middle: Purple (#8b5cf6)
  - Inner: Orange (#f97316)
- Logo scales up with spring animation

**Bottom:**
- "Loading your fitness journey..." text in Slate-400
- Small progress ring (circular, brand-consistent)

### Copy
```
[FitCircle Logo Animation]
Loading your fitness journey...
```

### Interactions
- None (auto-advances after 2 seconds or assets loaded)

### Technical Requirements
- Preload critical assets (fonts, core icons)
- Initialize Supabase connection
- Check for existing session (returning user bypass)
- Detect device capabilities (camera, motion sensors)

### Skip Conditions
- Returning users skip entirely
- Users with active session go straight to dashboard

### Success Criteria
- 100% view rate (mandatory)
- <2 second duration
- Smooth animation at 60fps

---

## Screen 1: Welcome & Email Login

### Purpose
Communicate core value proposition, minimize signup friction with simple email authentication

### Visual Design

**Layout:**
- Full-screen dark background (Slate-950)
- Top 40%: Hero visual
- Middle 40%: Value propositions
- Bottom 20%: Login options

**Hero Visual:**
- Animated activity rings showing progress
- Silhouettes of 3 diverse people celebrating
- Floating "+$500", "Level Up!", "10-day streak!" badges
- Subtle confetti animation loop

**Value Props (3 cards):**
Each card: Glass-morphism background, icon, headline
1. 🏆 **Compete & Win** - "Join challenges, earn real money"
2. 👥 **Connect & Support** - "Find your fitness tribe"
3. 🤖 **Coach & Grow** - "AI-powered personal guidance"

**Login Section:**
- Clean email/password form with rounded inputs
- Modern, minimalist design with clear labels
- "Sign Up" and "Log In" toggle

### Copy

**Headline:**
```
Welcome to FitCircle
Where Fitness Meets Fun & Fortune
```

**Subtext:**
```
Join thousands competing, connecting, and crushing their goals
```

**Form Fields:**
- Email input (placeholder: "Enter your email")
- Password input (placeholder: "Create a password")
- Toggle link: "Already have an account? Log in"

**Primary Button:**
- "Get Started" (Sign Up mode)
- "Welcome Back" (Log In mode)

**Footer:**
```
By continuing, you agree to our Terms & Privacy Policy
```

### Interactions

**User Actions:**
1. Enter email → Validate format on blur
2. Enter password → Show strength indicator (for sign up)
3. Tap "Sign Up/Log In" toggle → Switch form mode
4. Tap "Get Started" → Validate and proceed to Screen 2
5. Tap Terms/Privacy → Open modal (don't leave flow)

**Micro-interactions:**
- Input fields highlight on focus with purple glow
- Password strength indicator fills (weak → strong)
- Submit button scales on press (haptic feedback)
- Value prop cards parallax on scroll
- Ring animation loops continuously
- Form validation shows inline errors

### Technical Requirements

**Authentication:**
- Supabase Auth with email/password
- Email validation: RFC 5322 compliant
- Password requirements: Min 8 chars, 1 uppercase, 1 number
- Rate limiting: Max 5 attempts per 15 minutes
- Email verification: Send confirmation link (verify later, don't block onboarding)

**Data Captured:**
- User ID (generated by Supabase)
- Email address
- Password (hashed by Supabase)
- Referral code (if present in URL)
- Account creation timestamp

**Tracking:**
```javascript
analytics.track('Onboarding Started', {
  entry_point: 'web' | 'referral' | 'app_store',
  referral_code: code || null,
  device_type: 'ios' | 'android' | 'web'
});
```

### Skip Conditions
- Returning users (already authenticated)
- Skip not available for new users

### Success Criteria
- 85%+ proceed to Screen 2
- <10% drop-off at this screen
- <3% form validation errors
- Average time: 30-45 seconds
- Email verification completion: 60% within 24 hours (non-blocking)

---

## Screen 2: Persona Detection & Goal Setting

### Purpose
Understand user motivations to personalize flow, set initial goals, detect persona type

### Visual Design

**Layout: Interactive Questionnaire (Single Question Per View)**

**Background:**
- Animated gradient background that changes per question
- Circular progress indicator (top right): "2/4"
- Back button (top left) to return to previous question

**Question Format:**
- Large, bold headline
- 3-4 option cards (glass-morphism style)
- Each card has icon, title, subtitle
- Cards animate in with staggered timing

### Copy & Question Flow

**Question 1/4: Primary Goal**
```
Headline: "What's your main fitness goal?"

Options:
🎯 Lose Weight
   "Drop pounds, look great, feel amazing"
   [Weight persona signal]

💪 Get Stronger
   "Build muscle, increase endurance"
   [Fitness fanatic signal]

🤝 Stay Accountable
   "Find support and consistency"
   [Social persona signal]

🏃 Just Stay Active
   "Move more, live healthier"
   [Casual user signal]
```

**Question 2/4: Motivation Style**
```
Headline: "What drives you most?"

Options:
🏆 Competition
   "I love winning and crushing goals"
   [Competitive Casey signal ++]

❤️ Community
   "I need friends and support"
   [Social Sarah signal ++]

📊 Progress Tracking
   "I love seeing data and results"
   [Motivated Mike signal ++]

💰 Money & Rewards
   "Show me the prizes!"
   [Competitive Casey signal +]
```

**Question 3/4: Current Fitness Level**
```
Headline: "Where are you starting from?"

Options:
🌱 Beginner
   "Just getting started"

🚶 Intermediate
   "Somewhat active"

🏃 Advanced
   "Regular gym-goer"

⭐ Athlete
   "Train seriously"
```

**Question 4/4: Time Commitment**
```
Headline: "How much time can you dedicate?"

Options:
⚡ 15-30 min/day
   "Quick and efficient"
   [Mike signal +]

⏰ 30-60 min/day
   "Solid commitment"

⏳ 60+ min/day
   "Fitness is priority"
   [Fiona signal +]

🤷 Varies day-to-day
   "Flexible schedule"
```

### Interactions

**User Actions:**
- Tap option card → Highlights, proceeds to next question
- Back button → Returns to previous question
- Progress ring fills as questions complete

**Animations:**
- Option cards slide in from bottom (staggered)
- Selected card glows and scales slightly
- Background gradient shifts on selection
- Progress ring animates clockwise

### Technical Requirements

**Persona Scoring Algorithm:**
```typescript
interface PersonaScores {
  casey: number;    // Competitive
  sarah: number;    // Social
  mike: number;     // Practical
  fiona: number;    // Fitness fanatic
}

// Calculate based on answers
// Highest score determines primary persona
// Second highest determines secondary traits
```

**Data Captured:**
- Primary goal
- Motivation style (key persona signal)
- Fitness level
- Time commitment
- Calculated primary persona
- Calculated secondary traits

**Flow Branching:**
After Screen 2, branch based on detected persona:
- **Casey (Competitive):** Emphasize challenges, leaderboards, prizes
- **Sarah (Social):** Emphasize teams, friends, community
- **Mike (Practical):** Emphasize AI coach, quick wins, efficiency

### Skip Conditions
- Allow skip with "I'll set this up later" link
- If skipped, default to balanced flow

### Success Criteria
- 85%+ complete all 4 questions
- <10% skip
- Average time: 60 seconds
- Persona detection accuracy: 80%+

---

## Screen 3A: Meet Fitzy (AI Coach Introduction)

### Purpose
Introduce AI coach as friendly guide, deliver first personalized insight, create "aha moment"

### Visual Design

**Layout:**
- Center: Large Fitzy avatar (animated 3D character)
- Fitzy: Friendly robot/coach hybrid
  - Circular body with activity rings
  - Expressive eyes
  - Color-shifting accents (matches detected persona)
- Speech bubble with personalized message
- "Continue" button at bottom

**Fitzy Avatar Animation:**
- Materializes with particle effect
- Idle animation: Gentle bobbing, blinking
- Talking animation when message appears
- Gestures toward key points

**Background:**
- Dark gradient with subtle circular patterns
- Animated energy particles flowing toward Fitzy

### Copy (Personalized by Persona)

**For Casey (Competitive):**
```
Fitzy: "Hey there, champion! 💪

I'm Fitzy, your AI fitness coach. I've analyzed your goals, and I can already tell you're built to compete.

Here's your first insight:
Users like you who join challenges within 48 hours are 4x more likely to hit their goals. You ready to prove you're the best?

Let's get you set up to dominate! 🏆"

[Continue Button: "Let's Win This"]
```

**For Sarah (Social):**
```
Fitzy: "Welcome to the family! 🤗

I'm Fitzy, your AI coach and cheerleader. I've learned about your goals, and I think FitCircle is perfect for you.

Here's your first insight:
People who work out with friends lose 3x more weight and have way more fun doing it. Ready to find your fitness squad?

Let's build your support crew! ❤️"

[Continue Button: "Find My People"]
```

**For Mike (Practical):**
```
Fitzy: "Great to meet you! 👋

I'm Fitzy, your AI coach. Based on your goals and schedule, I've already started building your personalized plan.

Here's your first insight:
With just 20 minutes a day, you can lose 15-20 lbs in 12 weeks. I'll make every minute count with data-driven strategies.

Let's set up your efficient path to results! 📊"

[Continue Button: "Show Me the Plan"]
```

### Interactions

**User Actions:**
- Tap Continue → Proceed to Screen 4
- Fitzy responds to taps with reactions
- Swipe up on speech bubble to expand for more detail

**Animations:**
- Fitzy entrance: Materializes with glow effect
- Text appears with typewriter effect (fast)
- Fitzy animates while "talking"
- Continue button pulses gently

**Easter Egg:**
- Tap Fitzy 3x rapidly → Special animation + "You found me! +10 XP" (first achievement)

### Technical Requirements

**Personalization Logic:**
```typescript
// Generate message based on:
- Detected persona (Casey/Sarah/Mike/Fiona)
- Selected goal
- Time of day (morning/evening greeting)
- Referral context (if invited by friend)

// Fetch from AI service:
- Personalized insight
- Relevant success statistics
```

**Data Captured:**
- User saw Fitzy introduction
- Time spent on screen
- Easter egg discovery (if triggered)

**First Achievement:**
If user taps Fitzy 3x:
```
Achievement Unlocked: "Curious Explorer"
You found Fitzy's secret! +10 XP
```

### Skip Conditions
- Not skippable (critical for engagement)
- Auto-advance after 30 seconds if no interaction

### Success Criteria
- 95%+ engagement (interact with screen)
- Average time: 20 seconds
- 15%+ discover easter egg
- User sentiment: "This is different!" feeling

---

## Screen 3B: Quick Profile Setup

### Purpose
Collect essential profile data, create sense of identity and ownership

### Visual Design

**Layout: Single-Column Form**

**Top Section (30%):**
- Profile photo placeholder (large circle)
- "Tap to add photo" text
- Camera icon overlay

**Middle Section (50%):**
- Form fields with floating labels
- Glass-morphism input backgrounds
- Real-time validation

**Bottom Section (20%):**
- Large "Continue" button
- "Skip for now" link

**Visual Elements:**
- Avatar circle has animated border (cycling through brand colors)
- Fields have subtle glow on focus
- Character counters for text inputs

### Copy

**Headline:**
```
Let's personalize your profile
```

**Subtext:**
```
Help your FitCircle friends recognize you
```

**Form Fields:**
1. **Display Name** (required)
   - Placeholder: "What should we call you?"
   - Character limit: 30
   - Validation: No special characters except dash/underscore

2. **Username** (required)
   - Placeholder: "@username"
   - Auto-generates from display name
   - Checks availability in real-time
   - Shows ✓ or ✗ as user types

3. **Bio** (optional)
   - Placeholder: "Tell us about yourself... (optional)"
   - Character limit: 150
   - Shows character count

4. **Profile Photo** (optional)
   - "Add Photo" or "Choose Avatar"
   - If skipped, generates avatar from initials + color

**Buttons:**
- [Continue] (Primary, disabled until required fields valid)
- [Skip for now] (Link style, smaller)

### Interactions

**User Actions:**

1. **Tap Photo Circle:**
   - Shows bottom sheet with options:
     - 📷 Take Photo
     - 🖼️ Choose from Library
     - 🎨 Generate Avatar
     - ❌ Cancel

2. **Type Display Name:**
   - Auto-generates username
   - Shows suggestion: "We suggest: @john_smith"
   - User can edit username

3. **Type Username:**
   - Real-time availability check
   - Shows status: "Checking..." → "Available ✓" | "Taken ✗"
   - Suggests alternatives if taken

4. **Tap Continue:**
   - Validates form
   - Shows loading state
   - Proceeds to next screen

5. **Tap Skip:**
   - Shows confirmation: "Set up profile later? You can always edit in settings."
   - [Skip] [Go Back] buttons

**Animations:**
- Fields slide up when keyboard appears
- Validation icons fade in
- Success checkmark animates
- Form submission shows circular progress

### Technical Requirements

**Image Handling:**
```typescript
// Camera/Gallery
- Request camera permission (if taking photo)
- Request photo library permission (if choosing)
- Crop to square
- Compress to <500KB
- Upload to Supabase Storage
- Generate thumbnail

// Avatar Generation (if no photo)
- Use initials (first + last)
- Random color from palette
- Circular background
```

**Username Validation:**
```typescript
// Real-time check
- Debounce input (300ms)
- Check against profiles table
- Validate format: alphanumeric + dash/underscore
- 3-20 characters

// Suggestions if taken
username_1, username_2, username_year
```

**Data Captured:**
- Display name
- Username (unique)
- Bio (optional)
- Profile photo URL or avatar config
- Photo upload source (camera/library/avatar)

**Database Insert:**
```sql
UPDATE profiles SET
  display_name = $1,
  username = $2,
  bio = $3,
  avatar_url = $4,
  onboarding_step = 3
WHERE id = auth.uid();
```

### Skip Conditions
- Skip allowed (link at bottom)
- If skipped, generates default username and avatar
- Can complete later in settings

### Success Criteria
- 75%+ add display name
- 60%+ add custom username
- 40%+ add profile photo
- 25%+ write bio
- <20% skip entirely
- Average time: 45 seconds

---

## Screen 4: Set Your First Goals

### Purpose
Define measurable targets, establish baseline, create commitment

### Visual Design

**Layout: Tabbed Interface (3 Tabs)**

**Tabs:**
1. **Weight** (default) - Shows first
2. **Steps**
3. **Habits** (optional)

Each tab shows:
- Large circular input/slider for primary metric
- Target goal setting
- Timeline picker
- Visual preview of progress ring

**Tab 1: Weight Goal**

**Center Element:**
- Large circular dial for current weight
- Drag to adjust or type in center
- Units toggle (lbs/kg) in corner
- Weight updates in real-time

**Below Center:**
- Target weight input (smaller dial)
- Timeline selector: "I want to reach this in..."
  - 4 weeks
  - 8 weeks
  - 12 weeks (recommended)
  - 16 weeks
  - Custom

**Visual Preview:**
- Shows activity ring preview
- Displays: "You'll need to lose X lbs/week"
- Color codes feasibility:
  - Green: Healthy pace (1-2 lbs/week)
  - Yellow: Aggressive (2-3 lbs/week)
  - Red: Unrealistic (>3 lbs/week, shows warning)

**Tab 2: Steps Goal**

**Center Element:**
- Large circular meter
- Current average (if available from device)
- Target steps selector

**Preset Options:**
- 5,000 steps (Casual)
- 8,000 steps (Active)
- 10,000 steps (Recommended)
- 12,000+ steps (Athlete)
- Custom

**Visual:**
- Animated steps icon
- Preview: "That's about X miles/day"

**Tab 3: Habits (Optional)**

**Format: Checklist Style**

Pick 1-3 habits to track:
- ☐ Drink 8 glasses of water
- ☐ Sleep 7-8 hours
- ☐ Log all meals
- ☐ 15-min workout daily
- ☐ No late-night snacks
- ☐ Custom...

Each has toggle + brief description

### Copy

**Headline:**
```
Set your first goals
```

**Subtext (Weight Tab):**
```
Current weight: [Interactive Dial]
Goal weight: [Interactive Dial]
Timeline: [Selector]

"Great! At this pace, you'll lose X lbs per week - a healthy sustainable rate."
```

**Subtext (Steps Tab):**
```
Current average: 6,500 steps/day
New goal: [Selector]

"10,000 steps is proven to improve health and aid weight loss."
```

**Subtext (Habits Tab):**
```
"Track healthy habits to build consistency"
Pick 1-3 to start
```

**Buttons:**
- [Continue] (Primary)
- [Skip for now] (Link)

### Interactions

**User Actions:**

1. **Adjust Weight Dial:**
   - Circular drag gesture
   - Haptic feedback at every 5 lbs
   - Type in center to input directly

2. **Select Timeline:**
   - Tap option to select
   - Shows calculation instantly
   - Warning appears if unhealthy

3. **Switch Tabs:**
   - Swipe left/right between tabs
   - Or tap tab labels
   - Progress saved per tab

4. **Toggle Habits:**
   - Tap to enable/disable
   - Max 3 selections
   - "Custom" opens text input

5. **Tap Continue:**
   - Validates at least one goal set
   - Saves to database
   - Proceeds to next screen

**Animations:**
- Dial rotation is smooth with momentum
- Selected options highlight with glow
- Warning shake animation if unrealistic
- Tab transitions slide horizontally

**Smart Defaults:**
```typescript
// If no weight set, use:
- Average for height/age/gender (if available)
- Or prompt: "Enter current weight to set goal"

// If no steps data available:
- Default to 10,000 steps
- Note: "We'll personalize this once you track"

// Timeline default: 12 weeks (recommended)
```

### Technical Requirements

**Data Validation:**
```typescript
// Weight
- Min: 50 lbs / 22 kg
- Max: 500 lbs / 227 kg
- Target must be < current (for weight loss)
- Max loss rate: 2 lbs/week (warning if exceeded)

// Steps
- Min: 1,000
- Max: 50,000
- Realistic range: 5,000-15,000

// Habits
- Min: 0 (skippable)
- Max: 3 for onboarding
```

**Goal Calculation:**
```typescript
// Weight loss rate
const weeksToGoal = selectedTimeline;
const totalLoss = currentWeight - targetWeight;
const lossPerWeek = totalLoss / weeksToGoal;

// Health check
if (lossPerWeek > 2) {
  showWarning('This is aggressive. 1-2 lbs/week is recommended.');
}
```

**Data Captured:**
- Current weight (lbs/kg)
- Target weight (lbs/kg)
- Timeline (weeks)
- Daily steps goal
- Selected habits (array)
- Goal creation timestamp

**Database Insert:**
```sql
-- User goals table
INSERT INTO user_goals (
  user_id,
  goal_type,
  current_value,
  target_value,
  timeline_weeks,
  created_at
) VALUES (...);

-- Daily tracking entry (baseline)
INSERT INTO daily_tracking (
  user_id,
  date,
  weight,
  ...
) VALUES (...);
```

### Skip Conditions
- At least one goal type required (weight OR steps)
- Habits tab fully optional
- Can edit goals later in settings

### Success Criteria
- 90%+ set weight goal
- 70%+ set steps goal
- 40%+ select at least one habit
- Average time: 90 seconds
- <5% show "unrealistic" warning

---

## Screen 5A (Casey): Challenge Discovery

**[For Competitive Persona]**

### Purpose
Show available challenges, emphasize prizes and competition, drive early challenge join

### Visual Design

**Layout: Vertical Scroll Feed**

**Hero Section (Top):**
- "Ready to compete?" headline
- Fitzy avatar (small, corner): "I found challenges perfect for you!"
- Filter chips: All | Weight Loss | Steps | Beginner

**Challenge Cards (3-4 visible):**

Each card design:
- Glass-morphism background
- Header: Challenge name + emoji
- Prize amount (large, prominent): "$500 prize pool"
- Key stats in circular badges:
  - ⏱️ Duration: "4 weeks"
  - 👥 Participants: "47 joined"
  - 🎯 Goal: "Lose 5%"
- Progress indicator: "Starts in 2 days"
- Join button (Primary CTA)
- [Free] or [$20 entry] badge

**Recommended Challenge (Top Card):**
- "Perfect Match" badge
- Glow effect around card
- Highlighted with accent color

### Copy

**Headline:**
```
You're built to compete 🏆
```

**Subtext:**
```
Join a challenge and start winning
```

**Challenge Card Example 1 (Recommended):**
```
🔥 New Year Shred Challenge
$500 Prize Pool • 47 competitors

📉 Lose 5% body weight in 4 weeks
🥇 Top 10 finishers split the prize
⚡ Starts Monday, Jan 15

[Join Free - No Entry Fee] (Button)

"Perfect for your goals!" - Fitzy
```

**Challenge Card Example 2:**
```
💪 10K Steps Squad
$200 Prize Pool • 83 competitors

👟 Hit 10,000 steps daily for 2 weeks
🏅 Everyone who completes splits prize
⚡ Starting now - rolling entry

[$10 Entry Fee] (Button)
```

**Challenge Card Example 3:**
```
⭐ Beginner Bootcamp (Free)
No stakes, just support

🎯 Log progress 5 days/week for 2 weeks
👥 Team support and accountability
🎁 Earn XP and badges

[Join Challenge] (Button)
```

**Bottom CTA:**
```
Or [Create Your Own Challenge]
```

### Interactions

**User Actions:**

1. **Scroll to Browse:**
   - Infinite scroll loads more challenges
   - Pull-to-refresh updates list

2. **Tap Filter Chips:**
   - Filters challenge list
   - Smooth transition

3. **Tap Challenge Card:**
   - Expands card to full details view
   - Shows:
     - Full description
     - Rules and requirements
     - Prize distribution details
     - Participant list (avatars)
     - [Join] or [Learn More] buttons

4. **Tap Join Button:**
   - Free challenges: Instant join + confirmation
   - Paid challenges: Show payment sheet
   - Confirmation animation + confetti

5. **Tap "Create Your Own":**
   - Navigates to challenge creation flow (separate)

**Animations:**
- Cards fade in on scroll
- Recommended card pulses gently
- Prize amounts have shimmer effect
- Join button scales on press
- Confetti burst on successful join

### Technical Requirements

**Challenge Matching Algorithm:**
```typescript
// Score challenges based on:
- User's weight loss goal (% match)
- User's fitness level (beginner tag boost)
- User's timeline (duration preference)
- Prize amount (engagement predictor)
- Participant count (social proof)

// Sort by:
1. Recommended (highest score)
2. Starting soon
3. Most popular
4. Newest
```

**Data Sources:**
```sql
-- Fetch active challenges
SELECT * FROM challenges
WHERE status = 'open'
  AND start_date > NOW()
  AND (
    is_free = true OR
    entry_fee <= user_budget_preference
  )
ORDER BY recommended_score DESC;
```

**Data Captured:**
- Challenges viewed (impression tracking)
- Filters applied
- Cards tapped (engagement)
- Challenges joined
- Time spent browsing

**Analytics Events:**
```typescript
analytics.track('Challenge Discovered', {
  challenge_id,
  is_recommended,
  prize_amount,
  entry_fee,
  position_in_list
});

analytics.track('Challenge Joined', {
  challenge_id,
  source: 'onboarding',
  time_to_join_seconds
});
```

### Skip Conditions
- Skip allowed with "Browse later" link
- Can join challenges anytime from dashboard
- If skipped, shows reminder notification in 24 hours

### Success Criteria
- 60%+ browse challenges
- 35%+ join at least one challenge
- 70%+ of joins are free/beginner challenges
- Average challenges viewed: 5+
- Average time: 90 seconds

---

## Screen 5B (Sarah): Find Your FitCircle

**[For Social Persona]**

### Purpose
Help user connect with friends, create or join FitCircle (friend group), emphasize community

### Visual Design

**Layout: Two-Section Screen**

**Top Section (50%): Invite Friends**

- Headline: "Bring your friends!"
- Subtext: "Fitness is better together"
- Contact list integration (if permitted)
- Manual invite options (SMS, Email, Social)
- Friend suggestions based on email domain matches (optional)

**Bottom Section (50%): Join a FitCircle**

- Headline: "Or join an existing FitCircle"
- 3-4 active FitCircle cards showing:
  - FitCircle name + avatar
  - Member count + photos
  - Activity level ("Very Active", "Daily check-ins")
  - Description
  - [Request to Join] button

**Alternative: Create Your Own**
- Large card: "Create Your Own FitCircle"
- Icon: Plus in circle
- Button: "Start Your Circle"

### Copy

**Headline:**
```
Find your fitness family 👥
```

**Subtext:**
```
You're 3x more likely to succeed with friends
```

**Invite Friends Section:**
```
Invite friends from:
[Import Contacts] (with permission prompt)
[Share Link] (Copy to clipboard)
[Text Friends] (Opens SMS)
[Email Invite] (Opens email)
```

**FitCircle Card Example 1:**
```
💜 Monday Motivation Crew
12 members • Very active

"Supporting each other to lose 20 lbs by summer!"

Sarah, Mike, 10 others
[Request to Join]
```

**FitCircle Card Example 2:**
```
🏃‍♀️ Morning Runners
8 members • Daily check-ins

"5am crew getting steps in before work"

Emma, Jake, 6 others
[Request to Join]
```

**Create Card:**
```
✨ Create Your Own FitCircle

Be the founder! Invite friends and set your group goals

[Start Your Circle]
```

**Bottom Link:**
```
[I'll do this later]
```

### Interactions

**User Actions:**

1. **Tap "Import Contacts":**
   - Request contacts permission
   - Show list of contacts with FitCircle accounts
   - Multi-select to invite
   - Send invites

2. **Tap "Share Link":**
   - Generates unique referral link
   - Copies to clipboard
   - Shows share sheet (native iOS/Android)
   - Options: SMS, WhatsApp, Instagram, etc.

3. **Tap FitCircle Card:**
   - Expands to show full details
   - Member profiles
   - Recent activity feed
   - [Request to Join] or [Join Instantly] (if open)

4. **Tap "Request to Join":**
   - Sends join request to admin
   - Shows "Request Sent" confirmation
   - Proceeds to next screen

5. **Tap "Create Your Circle":**
   - Opens FitCircle creation wizard
   - Name, description, privacy settings
   - Invite initial members
   - Success: Created + invited friends

6. **Tap "I'll do this later":**
   - Skips social setup
   - Proceeds to next screen

**Animations:**
- Contact list slides up from bottom
- Share link copies with checkmark animation
- FitCircle cards have hover effect (on mobile: press)
- Member avatars animate in (staggered)
- Success confetti on join/create

### Technical Requirements

**Contacts Integration:**
```typescript
// Request permission
await Contacts.requestPermission();

// Match contacts to users
const matches = await matchContactsToUsers(contacts);

// Show invitation UI
showInviteList(matches);
```

**Referral Link Generation:**
```typescript
// Generate unique link
const referralCode = generateCode(userId);
const link = `https://fitcircle.app/join/${referralCode}`;

// Track referrals
await trackReferralLink(userId, referralCode);
```

**FitCircle Matching:**
```sql
-- Suggest FitCircles based on:
- Similar goals (weight loss, steps)
- Similar demographics (age, location)
- Activity level match
- Open/accepting members

SELECT * FROM fitcircles
WHERE is_accepting_members = true
  AND member_count < max_members
  AND (
    goal_type = user_goal_type OR
    location_proximity < 50 -- miles
  )
ORDER BY activity_score DESC
LIMIT 5;
```

**Data Captured:**
- Contacts permission granted/denied
- Invites sent (count, method)
- Referral link generated
- FitCircles browsed
- Join requests sent
- FitCircles created
- Skip action

### Skip Conditions
- Skip allowed ("I'll do this later")
- Can add friends anytime from dashboard
- Reminder notification sent in 48 hours

### Success Criteria
- 60%+ interact with friend features
- 30%+ invite at least 1 friend
- 25%+ join or create FitCircle
- Average invites sent: 2.5
- Average time: 90 seconds

---

## Screen 5C (Mike): Meet Your AI Coach

**[For Practical Persona]**

### Purpose
Showcase AI personalization, build trust in Fitzy, show first personalized plan

### Visual Design

**Layout: Conversational Interface**

**Background:**
- Clean, minimal
- Subtle gradient (Slate-950 to Slate-900)

**Center: Fitzy Character**
- Larger, more detailed than previous screens
- Animated, reacting to content
- Holds clipboard/tablet showing plan

**Message Bubbles (Chat Style):**
- Fitzy's messages on left (with avatar)
- User responses on right
- Typing indicators
- Smooth scroll as conversation progresses

**Bottom: Response Options**
- Quick reply buttons
- Multiple choice for user input

### Copy (Conversational Flow)

**Fitzy Message 1:**
```
Great! I've analyzed your goals and created a personalized plan just for you.

Based on your target (lose 25 lbs in 12 weeks) and schedule (20 min/day), here's what I recommend:

🔢 Your Daily Targets:
• 1,800 calories (-500 from baseline)
• 10,000 steps
• 20-min strength training (3x/week)

This gets you to your goal at a healthy 2 lbs/week pace.

Does this feel doable?

[Looks Perfect!] [Too Aggressive] [Too Easy]
```

**User Selects: "Looks Perfect!"**

**Fitzy Message 2:**
```
Awesome! 💪

I'll check in with you daily to:
✅ Track your progress
✅ Adjust your plan as needed
✅ Celebrate your wins
✅ Keep you motivated

Want to see your first workout?

[Yes, Show Me!] [Maybe Later]
```

**User Selects: "Yes, Show Me!"**

**Fitzy Message 3:**
```
Here's your Day 1 workout:

🏋️ 20-Minute Full Body Blast

Warm-up (5 min):
• Jumping jacks - 1 min
• Arm circles - 30 sec
• Bodyweight squats - 1 min
• ...

Main set (12 min):
• Push-ups - 3 sets of 10
• Squats - 3 sets of 15
• Plank - 3 x 30 seconds
• ...

Cool down (3 min):
• Stretching routine

[Start Workout] [Save for Later]

I'll guide you through each exercise with videos and form tips!
```

**Bottom CTA:**
```
[Continue to Dashboard]
```

### Interactions

**User Actions:**

1. **Read Messages:**
   - Auto-scrolls to latest message
   - Typing indicator shows before each message
   - Fitzy animates while "talking"

2. **Tap Quick Reply:**
   - Adds user's response to chat
   - Triggers next Fitzy message
   - Branching conversation based on choice

3. **Tap "Start Workout":**
   - Opens workout player (video + timer)
   - Guided exercise session
   - Tracks completion

4. **Tap "Save for Later":**
   - Bookmarks workout
   - Proceeds to next screen

5. **Tap "Continue to Dashboard":**
   - Completes onboarding
   - Goes to main app dashboard

**Animations:**
- Messages fade in with slide up
- Typing indicator pulses
- Fitzy animates (nod, point, celebrate)
- Quick reply buttons highlight on tap
- Success animations for positive interactions

### Technical Requirements

**AI Plan Generation:**
```typescript
// Inputs
const userProfile = {
  goals: { currentWeight, targetWeight, timeline },
  schedule: { availableTime, preferredTimes },
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced',
  equipment: ['none', 'dumbbells', 'gym'],
  preferences: { workoutTypes, dietRestrictions }
};

// Generate personalized plan
const plan = await generatePersonalizedPlan(userProfile);

// Returns:
{
  dailyCalories: 1800,
  macros: { protein: 135, carbs: 180, fat: 60 },
  dailySteps: 10000,
  workoutSchedule: [...],
  restDays: [...]
}
```

**Conversation Branching:**
```typescript
// Based on user responses, adjust messaging
if (userResponse === 'Too Aggressive') {
  // Fitzy adjusts plan downward
  // Shows revised targets
  // Reassures user
}

if (userResponse === 'Too Easy') {
  // Fitzy increases challenge
  // Shows revised targets
  // Encourages ambition
}
```

**Data Captured:**
- User responses to Fitzy
- Plan acceptance/rejection
- Adjustments requested
- Workout view/start
- Time spent in conversation

**Database Update:**
```sql
-- Save personalized plan
INSERT INTO user_plans (
  user_id,
  daily_calories,
  daily_steps,
  workout_schedule,
  created_by,
  is_active
) VALUES (
  $1, $2, $3, $4, 'fitzy_ai', true
);

-- Track interaction
INSERT INTO fitzy_conversations (
  user_id,
  conversation_type,
  messages,
  user_responses
) VALUES (...);
```

### Skip Conditions
- Not skippable (key value prop)
- Auto-advances if no interaction for 60 seconds

### Success Criteria
- 95%+ read entire conversation
- 80%+ accept plan as-is
- 40%+ view first workout
- 20%+ start first workout immediately
- Average time: 90 seconds

---

## Screen 6: Health Data & Permissions

### Purpose
Request necessary permissions, integrate health data, explain value clearly

### Visual Design

**Layout: Permission Request Cards**

**Top Section:**
- Headline explaining why we need permissions
- Fitzy avatar with encouraging message

**Permission Cards (3-4 cards):**

Each card has:
- Icon representing permission
- Permission name
- What we'll do with it
- What you'll get
- Toggle or Request button

**Cards Shown:**

1. **📊 Health Data Access**
   - iOS: HealthKit
   - Android: Google Fit / Health Connect
   - Toggle switches for specific data types

2. **🔔 Notifications**
   - Daily reminders
   - Challenge updates
   - Friend activity

3. **📍 Motion & Fitness**
   - Step counting
   - Activity recognition

4. **📷 Camera (Optional)**
   - Progress photos
   - Profile picture

**Bottom:**
- "Continue" button (enabled after minimum permissions)
- "I'll do this later" link

### Copy

**Headline:**
```
Let's connect your health data
```

**Subtext:**
```
This helps us personalize your experience and track your progress automatically
```

**Card 1: Health Data**
```
📊 Health Data Integration

We'll read:
✓ Weight
✓ Steps
✓ Workouts
✓ Active calories

We'll write:
✓ Workouts you log
✓ Your progress data

Why? Automatically sync your progress across all your fitness apps

[Connect Health Data]
```

**Card 2: Notifications**
```
🔔 Stay on Track

We'll send you:
• Daily check-in reminders (9 AM)
• Challenge updates (when you place)
• Friend encouragements (when earned)

Never miss your streak or a win!

[Enable Notifications]
```

**Card 3: Motion & Fitness**
```
🏃 Automatic Step Counting

Track steps without opening the app

Your phone counts steps in the background, and we'll automatically update your daily progress

[Enable Motion Access]
```

**Card 4: Camera (Optional)**
```
📷 Capture Your Progress

Take progress photos and see your transformation

Before & after photos are 10x more motivating than numbers alone!

[Enable Camera] [Skip]
```

**Privacy Note:**
```
🔒 Your data is private and secure
We never share your health data with third parties
[Read our Privacy Policy]
```

### Interactions

**User Actions:**

1. **Tap "Connect Health Data":**
   - iOS: Opens HealthKit permission sheet
   - Android: Opens Google Fit authorization
   - Shows granular toggles:
     - ☑️ Weight (required for weight loss challenges)
     - ☑️ Steps (required for step challenges)
     - ☑️ Workouts (optional, enhances tracking)
     - ☑️ Heart Rate (optional)
     - ☑️ Sleep (optional)

2. **Tap "Enable Notifications":**
   - Shows native notification permission prompt
   - iOS: System dialog
   - Android: System dialog
   - On grant: Shows confirmation

3. **Tap "Enable Motion Access":**
   - Shows motion permission prompt
   - Explains impact on battery (minimal)
   - On grant: Begins background step counting

4. **Tap "Enable Camera":**
   - Shows camera permission prompt
   - Optional, can skip
   - Also unlocks photo library access

5. **Tap "Continue":**
   - Validates minimum permissions (at least health data or motion)
   - Proceeds to next screen

6. **Tap "I'll do this later":**
   - Shows warning: "Some features won't work without permissions"
   - [Skip Anyway] [Go Back]

**Animations:**
- Cards slide in from bottom (staggered)
- Toggle switches animate smoothly
- Permission grants show checkmark + glow
- Success state for each granted permission

**Permission Status Indicators:**
```
⚪ Not Requested
🟡 Requested, Pending
🟢 Granted
🔴 Denied
```

### Technical Requirements

**iOS HealthKit Integration:**
```swift
// Request permission
HKHealthStore.requestAuthorization(
  toShare: [workoutType, weightType],
  read: [stepsType, weightType, workoutType]
) { success, error in
  // Handle response
}

// Read latest weight
let weightQuery = HKSampleQuery(...)
healthStore.execute(weightQuery)
```

**Android Health Connect:**
```kotlin
// Request permissions
val permissions = setOf(
  HealthPermission.READ_STEPS,
  HealthPermission.READ_WEIGHT,
  HealthPermission.WRITE_WEIGHT
)
healthConnectClient.permissionController.requestPermissions(permissions)

// Read data
val response = healthConnectClient.readRecords(...)
```

**Permission Tracking:**
```typescript
// Track permission status
const permissions = {
  healthData: 'granted' | 'denied' | 'not_requested',
  notifications: 'granted' | 'denied' | 'not_requested',
  motion: 'granted' | 'denied' | 'not_requested',
  camera: 'granted' | 'denied' | 'not_requested'
};

// Update profile
await updateUserPermissions(userId, permissions);
```

**Data Sync:**
```typescript
// Once granted, immediately sync
if (healthDataGranted) {
  const weight = await getLatestWeight();
  const steps = await getTodaySteps();

  // Update profile with baseline data
  await updateDailyTracking({
    weight,
    steps,
    source: 'healthkit' | 'googlefit'
  });
}
```

**Data Captured:**
- Permission statuses for each type
- Time granted/denied
- Health data sync success/failure
- Baseline data imported (weight, steps)

### Skip Conditions
- Minimum: Must grant health data OR motion
  - (Need at least one way to track progress)
- Notifications: Strongly encouraged, can skip
- Camera: Fully optional

### Success Criteria
- 85%+ grant health data access
- 70%+ enable notifications
- 75%+ enable motion tracking
- 30%+ enable camera
- <10% skip entirely
- Average time: 60 seconds

---

## Screen 7: First Check-In & Data Import

### Purpose
Establish baseline data, import historical data if available, create first daily entry

### Visual Design

**Layout: Loading + Progress Screen**

**Phase 1: Data Import (Auto, 5-10 seconds)**

**Center:**
- Large animated spinner (circular, brand colors)
- Fitzy avatar watching the import
- Progress text updating in real-time

**Text Updates:**
```
Importing your health data...
✓ Found 90 days of step data
✓ Found weight history
✓ Analyzing your patterns...
Generating insights...
```

**Phase 2: First Check-In Form**

**Layout:**
- Full-screen form
- Circular progress rings showing today's targets
- Input fields for daily metrics

**Metrics to Log:**

1. **Weight** (if not imported)
   - Large circular dial
   - Shows change from yesterday (if available)

2. **Steps** (pre-filled if available)
   - Shows current count from device
   - Green if synced automatically

3. **Mood** (emoji slider)
   - 😫 😕 😐 🙂 😄
   - Circular slider interface

4. **Energy Level** (1-10 scale)
   - Circular slider
   - Color shifts from red (low) to green (high)

5. **Quick Notes** (optional)
   - "How are you feeling today?"
   - Text input, 200 characters

**Bottom:**
- Large "Complete Check-In" button
- Shows XP reward: "+50 XP for your first check-in!"

### Copy

**Phase 1 (Import):**
```
Syncing your fitness data... 📊

[Animated progress indicator]

✓ Imported 90 days of activity
✓ Found your baseline patterns
✓ Detected your typical routines

Fitzy: "Wow, you averaged 7,500 steps/day last month! Let's beat that! 💪"
```

**Phase 2 (Check-In):**
```
Your first check-in! 🎉

Let's establish your starting point

Today's Targets:
[Circular rings showing: Weight, Steps, Mood, Energy]

Log today's metrics:

Weight: [Dial] 185 lbs
Steps: [Auto-filled] 3,247 (so far today)
Mood: [Emoji Slider] 🙂
Energy: [Circular Slider] 7/10

Quick note (optional):
[Text input]

[Complete Check-In] +50 XP
```

### Interactions

**User Actions:**

1. **Watch Import (Phase 1):**
   - Automatic, no user action
   - Shows progress of data import
   - Displays insights discovered
   - Auto-advances to Phase 2 when complete

2. **Adjust Weight Dial:**
   - Drag circular dial
   - Or tap center to type
   - Shows comparison to goal

3. **View Steps (Auto-Filled):**
   - Pre-populated from health data
   - User can manually adjust if needed
   - Tap to edit

4. **Adjust Mood Slider:**
   - Drag emoji slider
   - Haptic feedback on selection
   - Emoji animates when selected

5. **Adjust Energy Slider:**
   - Circular drag interface
   - Color changes with value
   - Haptic feedback at each number

6. **Type Quick Note:**
   - Optional, can skip
   - Shows character count
   - Suggests: "Feeling motivated to start!"

7. **Tap "Complete Check-In":**
   - Validates required fields (weight if not imported)
   - Saves to database
   - Shows success animation
   - Awards +50 XP (first achievement)
   - Proceeds to next screen

**Animations:**
- Import spinner with particle effects
- Checkmarks appear with bounce
- Insights fade in one by one
- Dials rotate smoothly with momentum
- Sliders glow when adjusted
- Success: Confetti + badge unlock animation

### Technical Requirements

**Data Import Logic:**
```typescript
// Fetch historical data from health sources
const importData = async () => {
  // Get last 90 days
  const startDate = subtractDays(new Date(), 90);

  // Import steps
  const stepsHistory = await getStepsHistory(startDate);

  // Import weight (if available)
  const weightHistory = await getWeightHistory(startDate);

  // Import workouts
  const workouts = await getWorkoutHistory(startDate);

  // Calculate insights
  const insights = analyzeHistory({
    steps: stepsHistory,
    weight: weightHistory,
    workouts
  });

  return { stepsHistory, weightHistory, workouts, insights };
};

// Example insights:
- Average steps/day
- Most active day of week
- Weight trend (up/down/stable)
- Workout frequency
```

**Baseline Calculation:**
```typescript
// Calculate user's baseline for personalization
const baseline = {
  avgSteps: calculateAverage(stepsHistory),
  typicalActiveTime: findPeakActivityTime(stepsHistory),
  workoutFrequency: workouts.length / 90,
  weightTrend: calculateTrend(weightHistory)
};

// Use to set realistic goals and personalize coaching
```

**First Check-In Save:**
```sql
-- Insert first daily tracking entry
INSERT INTO daily_tracking (
  user_id,
  date,
  weight,
  steps,
  mood,
  energy_level,
  notes,
  is_first_checkin
) VALUES (
  $1,
  CURRENT_DATE,
  $2, -- weight
  $3, -- steps
  $4, -- mood (1-5)
  $5, -- energy (1-10)
  $6, -- notes
  true
);

-- Award XP
INSERT INTO user_xp (
  user_id,
  amount,
  source,
  description
) VALUES (
  $1,
  50,
  'first_checkin',
  'Completed first daily check-in'
);

-- Update user level if needed
UPDATE profiles
SET
  total_xp = total_xp + 50,
  current_streak = 1,
  onboarding_step = 7
WHERE id = $1;
```

**Data Captured:**
- Historical data imported (steps, weight, workouts)
- Calculated baseline metrics
- First check-in data (weight, steps, mood, energy, notes)
- Time to complete first check-in
- Whether user added optional note

### Skip Conditions
- Cannot skip Phase 1 (import)
- Can skip optional fields in Phase 2 (mood, energy, notes)
- Weight required if not imported

### Success Criteria
- 100% complete Phase 1 (automatic)
- 90%+ complete Phase 2 check-in
- 80%+ log weight
- 70%+ set mood/energy
- 30%+ add quick note
- Average time: 60 seconds (Phase 2)

---

## Screen 8: First Achievement Celebration

### Purpose
Reward completion, create positive emotion, showcase gamification, motivate continued use

### Visual Design

**Layout: Full-Screen Celebration**

**Background:**
- Animated confetti falling
- Particles floating up
- Radial gradient burst from center

**Center:**
- Large animated badge/achievement icon
- Badge: "Welcome to FitCircle" achievement
- Circular frame with gleaming effect

**Badge Design:**
- Circular medal with ribbon
- FitCircle logo in center
- Text: "Onboarding Complete"
- Animated glow and sparkle effects

**Below Badge:**
- Achievement name
- XP earned (large, animated counting up)
- Level progress bar
- Milestone unlocked

**Bottom:**
- "Continue" button
- Preview: "See what's next..."

### Copy

**Headline:**
```
🎉 Congratulations!
```

**Subtext:**
```
You completed your FitCircle setup!
```

**Achievement Details:**
```
🏆 Achievement Unlocked

"Welcome to FitCircle"
You're officially part of the community!

+100 XP

Current Level: 1
Progress to Level 2: 150/500 XP

Unlocked Features:
✓ Daily check-ins
✓ Challenge participation
✓ FitCircle creation
✓ Fitzy AI coach
```

**Fitzy Message:**
```
[Fitzy avatar, celebrating]

"Amazing start! You've already earned 150 XP. Keep this momentum going and you'll hit your goals in no time! 💪"
```

**Bottom:**
```
[Continue to Dashboard]
```

### Interactions

**User Actions:**

1. **Watch Celebration:**
   - Automatic animation plays (3 seconds)
   - Badge animates with bounce + glow
   - XP counter animates up
   - Confetti falls
   - Sound effect plays (if enabled)

2. **Tap Badge:**
   - Expands to show full achievement details
   - Achievement description
   - Date earned
   - Rarity: "Earned by 100% of users"

3. **Tap "Continue to Dashboard":**
   - Completes onboarding
   - Navigates to main dashboard
   - Shows guided tour overlay (optional)

**Animations:**
- Badge scales up with spring animation
- Gleam effect sweeps across badge
- Confetti falls from top
- XP counter: Rapid count-up animation
- Level progress bar: Smooth fill animation
- Fitzy: Celebratory dance animation

**Sound Effects (if enabled):**
- Achievement unlock sound: Triumphant chime
- XP gain: Cash register "cha-ching"
- Confetti: Subtle whoosh

### Technical Requirements

**Achievement System:**
```sql
-- Award achievement
INSERT INTO user_achievements (
  user_id,
  achievement_id,
  earned_at,
  xp_awarded
) VALUES (
  $1,
  'welcome_to_fitcircle', -- achievement_id
  NOW(),
  100
);

-- Update user XP and level
UPDATE profiles
SET
  total_xp = total_xp + 100,
  onboarding_completed = true,
  onboarding_completed_at = NOW()
WHERE id = $1;

-- Check for level up
SELECT check_and_update_level($1);
```

**XP Calculation:**
```typescript
// Total XP from onboarding:
const onboardingXP = {
  createAccount: 0, // automatic
  completeProfile: 20, // if added photo/bio
  setGoals: 30,
  meetFitzy: 0, // automatic
  firstCheckIn: 50,
  joinChallenge: 50, // if joined
  inviteFriend: 50, // if invited
  welcomeAchievement: 100,
  // Total possible: 300 XP
};

// Level 1 → Level 2: 500 XP needed
// User should be ~30-60% to Level 2 after onboarding
```

**Onboarding Completion Tracking:**
```typescript
// Mark onboarding complete
await completeOnboarding(userId, {
  completedAt: new Date(),
  timeSpent: totalSeconds,
  stepsCompleted: completedSteps,
  skippedSteps: skippedSteps,
  personaDetected: persona,
  challengeJoined: joinedChallengeId || null,
  friendsInvited: inviteCount,
  totalXPEarned: xpSum
});

// Analytics
analytics.track('Onboarding Completed', {
  time_spent_seconds: totalSeconds,
  steps_completed: completedSteps.length,
  steps_skipped: skippedSteps.length,
  persona: persona,
  challenge_joined: !!joinedChallengeId,
  friends_invited: inviteCount,
  xp_earned: xpSum
});
```

**Data Captured:**
- Achievement earned (timestamp)
- Total XP earned from onboarding
- Current level
- Onboarding completion time
- All onboarding metrics aggregated

### Skip Conditions
- Not skippable (celebration is part of experience)
- Auto-advances after 5 seconds if no interaction

### Success Criteria
- 100% view celebration (automatic)
- Average celebration view time: 5-8 seconds
- 95%+ tap "Continue to Dashboard"
- User sentiment: Excited, motivated

---

## Screen 9: Dashboard Tour (Optional, First-Time Only)

### Purpose
Orient user to main dashboard, highlight key features, prevent overwhelm

### Visual Design

**Layout: Overlay Tour on Dashboard**

**Dashboard (Behind Tour):**
- User's actual dashboard, live data
- Slightly dimmed/blurred

**Tour Overlay:**
- Spotlight effect on current feature
- Dark overlay (80% opacity) everywhere else
- Tooltip/callout box with arrow
- Navigation dots at bottom
- Skip and Next buttons

**Tour Stops (5-6 highlights):**

1. **Daily Check-In Card**
2. **Activity Rings**
3. **Challenge Section**
4. **FitCircle Tab**
5. **Profile/Settings**
6. **Fitzy Chat Button**

### Copy

**Tour Welcome:**
```
Let's quickly tour your dashboard! 🗺️

This will take 30 seconds

[Start Tour] [Skip Tour]
```

**Stop 1: Daily Check-In**
```
⬇️ Daily Check-In

Log your weight, steps, mood, and energy here every day

Consistency = Streaks = XP = Success! 🔥

[Next] (1/6)
```

**Stop 2: Activity Rings**
```
⬇️ Activity Rings

Your progress rings show how you're tracking toward daily goals

Complete all rings to earn bonus XP! 💪

[Next] (2/6)
```

**Stop 3: Challenge Section**
```
⬇️ Active Challenges

Track your challenges here. Tap to see standings and compete!

You're 2nd place in "New Year Shred" - nice! 🏆

[Next] (3/6)
```

**Stop 4: FitCircle Tab**
```
⬇️ Your FitCircle

Connect with your fitness friends here

Share progress, cheer each other on! 👥

[Next] (4/6)
```

**Stop 5: Profile/Settings**
```
⬇️ Your Profile

Update goals, change settings, view achievements

Level up and unlock badges! ⭐

[Next] (5/6)
```

**Stop 6: Fitzy Button**
```
⬇️ Chat with Fitzy

Tap here anytime for:
• Workout suggestions
• Nutrition advice
• Motivation boost

Fitzy: "I'm always here to help! 🤖"

[Got It!] (6/6)
```

**Tour Complete:**
```
You're all set! 🎉

Ready to start your fitness journey?

[Go to Dashboard]
```

### Interactions

**User Actions:**

1. **Tap "Start Tour":**
   - Begins guided tour
   - Dashboard loads in background
   - First spotlight appears

2. **Tap "Next":**
   - Moves to next tour stop
   - Spotlight transitions smoothly
   - Tooltip repositions

3. **Tap "Skip Tour":**
   - Dismisses tour overlay
   - Goes straight to dashboard
   - Tour can be re-accessed from help menu

4. **Tap Outside Spotlight:**
   - No action (overlay blocks interaction)
   - Must use Next/Skip buttons

5. **Tap "Got It!":**
   - Completes tour
   - Removes overlay
   - Dashboard fully interactive

**Animations:**
- Spotlight moves smoothly between elements
- Tooltip fades out/in during transitions
- Progress dots update
- Dashboard elements slightly pulse when spotlighted

### Technical Requirements

**Tour State Management:**
```typescript
// Track tour progress
const tourState = {
  started: true,
  currentStop: 3,
  totalStops: 6,
  completed: false,
  skipped: false
};

// Save completion
await markTourCompleted(userId);

// Tour can be restarted from Help menu
```

**Tour Spotlight Effect:**
```css
/* Overlay with spotlight cutout */
.tour-overlay {
  background: radial-gradient(
    circle at ${x}px ${y}px,
    transparent 0%,
    transparent 100px,
    rgba(0,0,0,0.8) 150px
  );
}
```

**Data Captured:**
- Tour started (yes/no)
- Tour completed (yes/no)
- Tour skipped (at which stop)
- Time spent on each stop
- Total tour time

**Analytics:**
```typescript
analytics.track('Dashboard Tour Started');

// Per stop
analytics.track('Tour Stop Viewed', {
  stop_number: 3,
  stop_name: 'Challenge Section'
});

analytics.track('Dashboard Tour Completed', {
  time_spent_seconds,
  stops_viewed
});

analytics.track('Dashboard Tour Skipped', {
  at_stop: 2
});
```

### Skip Conditions
- Fully skippable (button always visible)
- Can restart from Help menu later
- Auto-skips for users who skip onboarding tour prompt

### Success Criteria
- 70%+ start tour
- 50%+ complete full tour
- 30%+ skip partway through
- Average tour time: 45 seconds
- <5% report confusion after tour

---

## Screen 10: Dashboard (Onboarding Complete)

### Purpose
User's home base, show all key metrics, provide clear next actions

### Visual Design

**Layout: Scrollable Dashboard**

**Header (Fixed):**
- Welcome message: "Welcome back, [Name]!"
- Current streak: "🔥 1-day streak"
- Level and XP bar
- Notification bell

**Section 1: Daily Check-In Card (Prominent)**
- Large glass-morphism card
- Quick entry for today's metrics
- Shows completion status
- If complete: "✓ You're all caught up!"
- If incomplete: "Log today's progress"

**Section 2: Activity Rings**
- Three circular rings (like Apple Watch)
  - Outer (Cyan): Steps goal
  - Middle (Purple): Weight loss progress
  - Inner (Orange): Check-in streak
- Tap to expand each ring for details

**Section 3: Active Challenges**
- Horizontal scrollable cards
- Each challenge shows:
  - Name and prize
  - Your current rank
  - Days remaining
  - Quick stats

**Section 4: FitCircle Feed**
- Recent activity from friends
- Like, comment, cheer actions
- "2 friends checked in today"

**Section 5: Fitzy's Daily Tip**
- Small card with today's insight
- "Tip: Drinking water before meals can reduce appetite by 30%"

**Floating Action Button (Bottom Right):**
- Fitzy chat icon
- Glowing animation
- Quick access to AI coach

### Copy

**Header:**
```
Good morning, Sarah! 👋
🔥 1-day streak • Level 1 • 150 XP
```

**Daily Check-In Card:**
```
Today's Check-In

[Quick log button]
or [Detailed entry]

"Keep your streak going! Daily check-ins build lasting habits" - Fitzy
```

**Activity Rings Section:**
```
Your Daily Rings

[Circular visualization with 3 rings]

Steps: 3,247 / 10,000 (32%)
Weight: On track
Streak: 1 day 🔥

Tap rings for details
```

**Active Challenges:**
```
Your Challenges (1)

[Card: New Year Shred Challenge]
🥈 2nd Place
$500 prize • 3 weeks left

You're 0.5 lbs behind 1st!

[View Details]
```

**FitCircle Feed:**
```
Your FitCircle

💜 Monday Motivation Crew

• Mike checked in and lost 2 lbs! 🎉
• Emma completed her workout 💪
• 3 others logged progress

[View All Activity]
```

**Fitzy's Tip:**
```
Today's Insight 💡

"Your step average is highest on Tuesdays. Try to match that pace today for an extra boost!"

- Fitzy
```

### Interactions

**New User Prompts (First Time Only):**

1. **Daily Check-In Prompt** (If not done yet)
   - Gentle reminder banner
   - "Complete your Day 1 check-in to start your streak!"

2. **Join Challenge Prompt** (If didn't join during onboarding)
   - Small banner: "Ready to compete? Join your first challenge!"
   - [Browse Challenges]

3. **Invite Friends Prompt** (If no friends invited)
   - Banner: "Fitness is better with friends! Invite your crew"
   - [Invite Friends]

**Guided Next Actions:**
- Checklist overlay (dismissible):
  ```
  Your First Week Checklist:
  ✓ Complete profile setup
  ✓ Meet Fitzy
  ✓ Log first check-in
  ☐ Join a challenge
  ☐ Invite 1 friend
  ☐ Complete 3 daily check-ins
  ☐ Reach Level 2
  ```

### Technical Requirements

**Dashboard Data Fetching:**
```typescript
// Fetch dashboard data
const dashboardData = await Promise.all([
  getUserProfile(userId),
  getTodayCheckIn(userId),
  getActiveChallenges(userId),
  getFitCircleActivity(userId),
  getDailyInsight(userId),
  getStreakData(userId)
]);

// Real-time updates via Supabase subscriptions
supabase
  .channel('dashboard')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'daily_tracking'
  }, handleUpdate)
  .subscribe();
```

**First-Time User Experience:**
```typescript
// Check if this is first dashboard visit
const isFirstVisit = await isFirstDashboardVisit(userId);

if (isFirstVisit) {
  // Show additional guidance
  showGuidedTour();
  showFirstWeekChecklist();
  highlightDailyCheckIn();

  // Mark as visited
  await markDashboardVisited(userId);
}
```

**Data Captured:**
- First dashboard visit timestamp
- Features interacted with
- Time spent on dashboard
- Sections scrolled to
- Next actions taken

### Skip Conditions
- N/A (final destination)

### Success Criteria
- 100% reach dashboard
- 80%+ complete Day 1 check-in from dashboard
- 50%+ interact with at least 3 dashboard sections
- 40%+ tap Fitzy chat within first day
- Average session time: 3-5 minutes

---

## Alternative Flows

### Flow A: Returning User (Has Account)

**Trigger:** User has existing account, trying to log in

**Flow:**
1. Screen 1: Welcome back screen
   - Email/password login
   - "Forgot password" link
2. Screen 2: Login success
   - Welcome back message
   - Shows streak and last check-in
3. Screen 3: Dashboard
   - Directly to dashboard
   - No onboarding tour

**Time:** <30 seconds

---

### Flow B: Social Invite (Referral Link)

**Trigger:** User clicks friend's referral link

**Flow Modifications:**

**Screen 1 (Modified):**
- Shows inviting friend's info
- "Sarah invited you to join FitCircle!"
- Friend's avatar and FitCircle name
- Personalized message from friend

**Screen 2 (Modified):**
- Pre-fills detected persona as "Social"
- Emphasizes social features

**Screen 5B (Auto):**
- Automatically navigates to social flow
- Shows friend's FitCircle prominently
- "Join Sarah's FitCircle?" prompt
- One-tap join

**Screen 8 (Modified):**
- Additional achievement: "Friend Referral"
- +50 XP for joining via referral
- Both user and referrer get bonus

**Benefits:**
- Faster social connection
- Higher engagement (friend waiting)
- Improved retention (social accountability)

**Time:** 6-8 minutes (slightly faster due to social context)

---

### Flow C: Quick Setup vs Full Setup

**Trigger:** User taps "Quick Setup" option on Screen 1

**Quick Setup Flow:**

1. **Screen 1:** Email login only
2. **Screen 2:** One-question goal selection
   - "What's your main goal?" (4 options)
3. **Screen 3:** Quick profile creation
   - Name input (required)
   - Skip photo/bio
4. **Screen 4:** Simplified goal setting
   - Pre-filled defaults based on goal selection
   - One-tap confirm
5. **Screen 5:** Skip persona-specific flow
   - Balanced approach
6. **Screen 6:** Minimal permissions
   - Only health data + notifications
7. **Screen 7:** Quick check-in
   - Weight only
   - Mood/energy optional
8. **Screen 8:** Achievement celebration
9. **Screen 9:** Dashboard (skip tour)

**Time:** 3-4 minutes

**Trade-offs:**
- ✅ Faster time to dashboard
- ✅ Lower drop-off risk
- ❌ Less personalization
- ❌ Lower data collection
- ❌ Potentially lower engagement

**Recommendation:** Offer quick setup option on Screen 1, but default to full setup. Power users and returning fitness app users will appreciate the option.

---

### Flow D: Progressive Onboarding (Delayed Elements)

**Concept:** Move non-critical steps to post-onboarding (in-app)

**Core Onboarding (Screens 1-8):**
- Focus only on:
  1. Authentication
  2. Basic profile
  3. Primary goal
  4. First check-in
  5. Celebration

**Time:** 3-5 minutes

**Post-Onboarding (In-App, Over First Week):**

**Day 1:**
- Prompt to join first challenge
- Guided tour of dashboard

**Day 2:**
- Invite friends prompt
- FitCircle creation wizard

**Day 3:**
- Set up secondary goals (steps, habits)
- Enable additional permissions

**Day 4:**
- Explore gamification (achievements, leaderboards)
- Customize notifications

**Day 5-7:**
- Advanced features (meal logging, workout library)
- Connect wearables
- Upgrade to Pro prompt

**Benefits:**
- ✅ Faster initial onboarding
- ✅ Progressive disclosure reduces overwhelm
- ✅ Features introduced when relevant
- ✅ Higher long-term engagement

**Recommendation:** Best approach for FitCircle. Balances time-to-value with comprehensive feature discovery.

---

## Key Metrics & Success Criteria

### North Star Metric

**Onboarding Completion Rate with D7 Retention**

> Users who complete onboarding AND return on Day 7

**Target:** 45% (Industry average: 15-20%)

**Rationale:** Completion alone isn't success; we need engaged users who stick around.

---

### Onboarding Funnel Metrics

| Screen | Step | Target Completion | Industry Avg | Drop-off Risk |
|--------|------|-------------------|--------------|---------------|
| 0 | Splash | 100% | 100% | None |
| 1 | Welcome/Login | 90% | 70% | **High** |
| 2 | Persona Detection | 85% | 60% | Medium |
| 3A | Meet Fitzy | 95% | N/A | Low |
| 3B | Profile Setup | 80% | 50% | Medium |
| 4 | Set Goals | 85% | 55% | Medium |
| 5 | Persona Flow | 75% | N/A | **High** |
| 6 | Permissions | 70% | 45% | **High** |
| 7 | First Check-In | 90% | N/A | Low |
| 8 | Celebration | 100% | N/A | None |
| 9 | Dashboard Tour | 70% | N/A | Low |
| 10 | Dashboard | 100% | N/A | None |

**Overall Completion Rate Target:** 65%

---

### Time-Based Metrics

| Metric | Target | Industry Avg |
|--------|--------|--------------|
| **Total Onboarding Time** | 7-9 minutes | 10-15 minutes |
| **Time to First Value** | 90 seconds | 3-5 minutes |
| **Time to First Check-In** | 5 minutes | N/A |
| **Time to First Challenge Join** | 8 minutes | N/A |
| **Time to Dashboard** | 7-9 minutes | 10-15 minutes |

---

### Engagement Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| **Persona Detection Accuracy** | 80%+ | Validated via user behavior post-onboarding |
| **Profile Photo Upload Rate** | 40%+ | Strong identity signal |
| **Challenge Join Rate (During Onboarding)** | 55%+ | Key activation metric |
| **Friends Invited (During Onboarding)** | 35%+ | Social network effect |
| **FitCircle Join/Create Rate** | 30%+ | Community building |
| **Permission Grant Rate (Health Data)** | 85%+ | Critical for tracking |
| **Permission Grant Rate (Notifications)** | 70%+ | Retention driver |
| **First Check-In Completion** | 90%+ | Habit formation start |

---

### Retention Metrics

| Metric | Target | Industry Avg |
|--------|--------|--------------|
| **D1 Retention** | 45% | 25% |
| **D7 Retention** | 30% | 15% |
| **D30 Retention** | 20% | 8-10% |
| **Onboarding Complete → D7 Return** | 70% | 40% |

---

### XP & Gamification Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| **Average XP Earned (Onboarding)** | 200-300 | Varies by actions taken |
| **Users Reaching Level 2 (Week 1)** | 40% | Requires 500 XP total |
| **Easter Egg Discovery Rate** | 15%+ | Fitzy tap interaction |
| **Achievement Unlock Rate** | 100% | Everyone gets "Welcome" badge |

---

### Business Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| **Cost Per Onboarding Complete** | <$30 | Includes CAC + server costs |
| **Onboarding Complete → Paid Conversion** | 15% | Within first 30 days |
| **Onboarding Complete → Referral** | 25% | Invite at least 1 friend |
| **LTV of Onboarded Users** | $85+ | Vs $15 for non-onboarded |

---

### Segmented Success Criteria

**By Persona:**

| Persona | Completion Rate Target | Challenge Join Rate | Friend Invite Rate | D7 Retention |
|---------|------------------------|---------------------|-------------------|--------------|
| Casey (Competitive) | 70% | 65% | 25% | 35% |
| Sarah (Social) | 65% | 45% | 60% | 40% |
| Mike (Practical) | 60% | 40% | 15% | 45% |

---

### Drop-Off Points to Monitor

**Critical Risk Points:**

1. **Screen 1 (Login):**
   - Issue: Authentication friction and form validation errors
   - Mitigation: Clear form validation, helpful error messages, password strength indicator
   - Target drop-off: <10%

2. **Screen 5 (Persona Flows):**
   - Issue: Too many options, decision fatigue
   - Mitigation: Clear CTAs, skip options, progress indicators
   - Target drop-off: <25%

3. **Screen 6 (Permissions):**
   - Issue: User doesn't understand value or privacy concerns
   - Mitigation: Clear explanations, privacy reassurance, granular control
   - Target drop-off: <30%

**Monitoring Strategy:**
```typescript
// Track funnel drop-offs
analytics.track('Onboarding Step Viewed', {
  step_number,
  step_name,
  time_spent_on_previous_step
});

analytics.track('Onboarding Step Completed', {
  step_number,
  step_name,
  time_spent_on_step
});

analytics.track('Onboarding Step Skipped', {
  step_number,
  step_name,
  reason: 'user_skip' | 'timeout' | 'error'
});

analytics.track('Onboarding Abandoned', {
  at_step,
  time_spent_total,
  device_type,
  entry_source
});
```

---

### A/B Testing Recommendations

**High-Impact Tests to Run:**

#### Test 1: Paywall Timing
- **Variant A:** No paywall in onboarding (current design)
- **Variant B:** Soft paywall after Screen 5 (skippable)
- **Variant C:** Hard paywall after Screen 7 (must choose free or paid)
- **Measure:** Completion rate, paid conversion rate, D7 retention

#### Test 2: Persona Flow vs Universal Flow
- **Variant A:** Branching persona flows (current design)
- **Variant B:** Single universal flow for all users
- **Measure:** Completion rate, engagement, personalization satisfaction

#### Test 3: Quick Setup vs Full Setup
- **Variant A:** Full setup only (current)
- **Variant B:** Offer quick setup option
- **Measure:** Completion rate, setup choice %, long-term engagement

#### Test 4: Gamification Intensity
- **Variant A:** High gamification (XP, levels, achievements visible)
- **Variant B:** Low gamification (minimal game elements)
- **Variant C:** Adaptive (show gamification only to Casey persona)
- **Measure:** Completion rate, D7 retention, long-term engagement

#### Test 5: Fitzy Introduction Timing
- **Variant A:** Fitzy intro at Screen 3 (current)
- **Variant B:** Fitzy throughout (appears on every screen)
- **Variant C:** Fitzy delayed until dashboard
- **Measure:** User sentiment, engagement with AI coach, completion rate

#### Test 6: Permission Request Bundling
- **Variant A:** Request permissions separately (current)
- **Variant B:** Request all permissions at once (Screen 6)
- **Variant C:** Just-in-time permission requests (when feature used)
- **Measure:** Permission grant rates, completion rate, feature adoption

**Testing Framework:**
```typescript
// Assign variant on first app open
const variant = assignVariant(userId, 'onboarding_test_1', ['A', 'B', 'C']);

// Track throughout
analytics.track('Onboarding Step Completed', {
  ab_test: 'onboarding_test_1',
  variant: variant,
  step_number,
  step_name
});

// Analyze results after 1,000+ completions per variant
```

---

## Implementation Considerations

### Progressive Web App (PWA) Specific

#### Installation Prompt
```typescript
// Trigger install prompt at optimal time
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

// Show install prompt after Screen 8 (celebration)
if (deferredPrompt) {
  const result = await deferredPrompt.prompt();
  if (result.outcome === 'accepted') {
    analytics.track('PWA Installed', { timing: 'post_onboarding' });
  }
}
```

**Install Prompt Timing Options:**
1. **After Celebration (Recommended):** User is excited, more likely to commit
2. **At Dashboard First Visit:** After seeing value
3. **After First Challenge Join:** When invested

**Target Install Rate:** 40% of onboarding completers

#### Offline Capability
```typescript
// Cache critical onboarding assets
const CACHE_NAME = 'fitcircle-onboarding-v1';
const urlsToCache = [
  '/onboarding',
  '/assets/fitzy-avatar.png',
  '/assets/celebration-confetti.json',
  // ... all onboarding screens
];

// Service worker caches assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});
```

**Benefit:** Smooth onboarding even with spotty connection

---

### Loading States & Animations

#### Loading Strategy

**Critical Render Path:**
1. Splash screen (instant)
2. Preload Screen 1 assets
3. Lazy load subsequent screens
4. Prefetch Screen N+1 when user reaches Screen N

**Loading State Patterns:**

```typescript
// Skeleton screens during data fetch
<SkeletonScreen type="profile_setup" />

// Progress indicators
<CircularProgress value={60} />

// Optimistic UI updates
updateUIImmediately(data);
syncToServerInBackground(data);

// Inline loading (for actions)
<Button loading={isSubmitting}>
  Continue
</Button>
```

**Animation Performance:**
- All animations run at 60fps (16.67ms per frame)
- Use CSS transforms (not position changes)
- Use `will-change` for animated elements
- Batch DOM updates
- Debounce real-time validation

---

### Error Handling

#### Error Categories & Strategies

**1. Network Errors**
```typescript
// Retry with exponential backoff
const retry = async (fn, maxAttempts = 3) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      await wait(2 ** i * 1000); // 1s, 2s, 4s
    }
  }
};

// Show user-friendly message
showToast('Connection issue. Retrying...', 'info');
```

**2. Validation Errors**
```typescript
// Inline field validation
<Input
  error={errors.email}
  helperText="Please enter a valid email"
/>

// Form-level validation
const errors = validateForm(formData);
if (errors.length > 0) {
  showValidationErrors(errors);
  return; // Don't proceed
}
```

**3. Authentication Errors**
```typescript
// Handle email/password authentication errors
try {
  await signInWithEmail(email, password);
} catch (error) {
  if (error.code === 'invalid_credentials') {
    showToast('Invalid email or password', 'error');
  } else if (error.code === 'email_not_confirmed') {
    showToast('Please verify your email address', 'warning');
    offerResendVerification();
  } else if (error.code === 'too_many_requests') {
    showToast('Too many attempts. Please try again in 15 minutes.', 'error');
  } else {
    showToast('Sign-in failed. Please try again.', 'error');
  }
}

// Offer password reset option
showForgotPasswordLink();
```

**4. Permission Denied Errors**
```typescript
// Explain impact and offer workaround
if (permissionDenied('notifications')) {
  showDialog({
    title: 'Notifications Disabled',
    message: 'You won\'t receive reminders, but you can still use FitCircle!',
    actions: [
      { label: 'Open Settings', onClick: openSettings },
      { label: 'Continue Without', onClick: proceed }
    ]
  });
}
```

**5. Data Import Errors**
```typescript
// Graceful degradation
try {
  const data = await importHealthData();
} catch (error) {
  // Continue without imported data
  console.warn('Health data import failed:', error);
  showToast('Couldn\'t import data. You can enter it manually.', 'warning');
  // Proceed to manual entry
}
```

#### Error Recovery Flow
```
Error Occurs
   ↓
Show User-Friendly Message
   ↓
Offer Action:
- Retry
- Skip and continue
- Try alternative method
- Contact support
   ↓
Log error for debugging
   ↓
Continue onboarding (don't block)
```

---

### Accessibility Requirements

#### WCAG AA Compliance

**Color Contrast:**
- Text on dark backgrounds: Minimum 4.5:1 ratio
- Large text (18pt+): Minimum 3:1 ratio
- Interactive elements: Minimum 3:1 ratio

**Keyboard Navigation:**
```typescript
// All interactive elements focusable
<Button tabIndex={0}>Continue</Button>

// Logical focus order
<form>
  <input tabIndex={1} />
  <input tabIndex={2} />
  <button tabIndex={3}>Submit</button>
</form>

// Focus trap in modals
<Modal>
  <FocusTrap>
    {/* Modal content */}
  </FocusTrap>
</Modal>
```

**Screen Reader Support:**
```jsx
// Semantic HTML
<main>
  <h1>Welcome to FitCircle</h1>
  <nav aria-label="Onboarding steps">
    {/* Progress indicator */}
  </nav>
</main>

// ARIA labels
<Button aria-label="Continue to next step">
  Continue
</Button>

// Live regions for dynamic content
<div aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>

// Form labels
<label htmlFor="weight-input">Current Weight</label>
<input id="weight-input" />
```

**Motion Sensitivity:**
```typescript
// Respect prefers-reduced-motion
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

// Disable animations if preferred
<Confetti animate={!prefersReducedMotion} />
```

**Touch Targets:**
- Minimum size: 44x44 pixels (iOS), 48x48 pixels (Android)
- Adequate spacing between tappable elements (8px min)

**Text Scaling:**
- Support dynamic type sizes
- Test at 200% zoom
- Ensure no content cut-off

---

### Mobile vs Desktop Adaptations

#### Responsive Breakpoints

```typescript
const breakpoints = {
  mobile: '< 640px',   // Single column, touch-first
  tablet: '640-1024px', // Two columns, hybrid input
  desktop: '> 1024px'   // Multi-column, mouse-first
};
```

#### Mobile-Specific Optimizations

**1. Touch Gestures:**
```typescript
// Swipe between screens
<Swipeable onSwipeLeft={nextScreen} onSwipeRight={previousScreen}>
  <OnboardingScreen />
</Swipeable>

// Pull to refresh (on data screens)
<PullToRefresh onRefresh={reloadData}>
  <Dashboard />
</PullToRefresh>
```

**2. Mobile-First Input Methods:**
```typescript
// Use native inputs
<input type="tel" inputMode="numeric" /> // For weight
<input type="date" /> // For goal timeline
<input type="email" autoComplete="email" /> // For login

// Native pickers where appropriate
<select> {/* Native dropdown on mobile */}
  <option value="4weeks">4 weeks</option>
  <option value="8weeks">8 weeks</option>
</select>
```

**3. Keyboard Management:**
```typescript
// Adjust viewport when keyboard appears
window.addEventListener('resize', handleKeyboard);

// Scroll active input into view
input.addEventListener('focus', () => {
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
```

#### Desktop-Specific Enhancements

**1. Larger Viewport Usage:**
```typescript
// Side-by-side layout on desktop
<Grid cols={2}>
  <LeftPanel /> {/* Preview/info */}
  <RightPanel /> {/* Form/input */}
</Grid>
```

**2. Mouse Interactions:**
```typescript
// Hover states
.button:hover {
  transform: scale(1.05);
}

// Tooltips on desktop
<Tooltip content="This helps us personalize your experience">
  <InfoIcon />
</Tooltip>
```

**3. Keyboard Shortcuts:**
```typescript
// Enter to continue
useKeyPress('Enter', () => {
  if (canProceed) nextScreen();
});

// Escape to go back
useKeyPress('Escape', () => {
  previousScreen();
});
```

---

### Performance Optimization

#### Core Web Vitals Targets

| Metric | Target | Onboarding Impact |
|--------|--------|-------------------|
| **LCP (Largest Contentful Paint)** | <2.5s | Screen 1 hero image load |
| **FID (First Input Delay)** | <100ms | Button tap responsiveness |
| **CLS (Cumulative Layout Shift)** | <0.1 | Form field rendering |
| **INP (Interaction to Next Paint)** | <200ms | Screen transitions |
| **TTFB (Time to First Byte)** | <600ms | Initial load |

#### Optimization Techniques

**1. Code Splitting:**
```typescript
// Lazy load screens
const Screen5 = lazy(() => import('./screens/Screen5'));
const Screen6 = lazy(() => import('./screens/Screen6'));

// Preload next screen
<link rel="prefetch" href="/onboarding/screen-2" />
```

**2. Image Optimization:**
```typescript
// Use WebP with fallback
<picture>
  <source srcSet="fitzy.webp" type="image/webp" />
  <img src="fitzy.png" alt="Fitzy coach" />
</picture>

// Responsive images
<img srcSet="
  fitzy-320w.webp 320w,
  fitzy-640w.webp 640w,
  fitzy-1024w.webp 1024w
" />

// Lazy load below-the-fold images
<img loading="lazy" src="..." />
```

**3. Asset Preloading:**
```html
<!-- Preload critical assets -->
<link rel="preload" href="/fonts/inter-var.woff2" as="font" crossorigin />
<link rel="preload" href="/animations/celebration.json" as="fetch" />
```

**4. Database Query Optimization:**
```typescript
// Batch related queries
const [profile, goals, challenges] = await Promise.all([
  getProfile(userId),
  getGoals(userId),
  getChallenges(userId)
]);

// Use database indexes
CREATE INDEX idx_user_id ON daily_tracking(user_id);
CREATE INDEX idx_challenge_status ON challenges(status, start_date);
```

**5. Caching Strategy:**
```typescript
// Cache static assets (1 year)
Cache-Control: public, max-age=31536000, immutable

// Cache API responses (5 minutes)
Cache-Control: public, max-age=300

// Don't cache user-specific data
Cache-Control: private, no-cache
```

**6. Animation Performance:**
```css
/* Use GPU-accelerated properties */
.animated {
  transform: translateX(0); /* ✅ Good */
  /* left: 0; ❌ Bad - triggers layout */

  will-change: transform; /* Hint to browser */
}

/* Use CSS animations over JS */
@keyframes slideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
```

---

### Data Privacy & Security

#### GDPR/CCPA Compliance

**1. Consent Management:**
```typescript
// Record consent
await recordConsent(userId, {
  termsAccepted: true,
  privacyAccepted: true,
  marketingOptIn: false, // Explicit opt-in
  timestamp: new Date()
});

// Store consent version
consentVersion: '2025-01-11-v1'
```

**2. Data Minimization:**
```typescript
// Only collect necessary data during onboarding
const requiredData = {
  email: true,
  name: true,
  goals: true,
  weight: true, // For weight loss challenges
};

const optionalData = {
  photo: false, // User choice
  bio: false,
  phone: false,
  birthdate: false
};
```

**3. Right to Access & Delete:**
```typescript
// Provide data export
async function exportUserData(userId) {
  const data = await getAllUserData(userId);
  return generateJSON(data); // GDPR format
}

// Provide deletion
async function deleteUserData(userId) {
  // Anonymize instead of hard delete (retain analytics)
  await anonymizeUser(userId);
  // Or hard delete if requested
  await hardDeleteUser(userId);
}
```

**4. Secure Data Transmission:**
```typescript
// Always use HTTPS
const API_URL = process.env.NEXT_PUBLIC_API_URL; // https://...

// Encrypt sensitive data in transit
const encrypted = await encrypt(sensitiveData, publicKey);

// Never log sensitive data
console.log('User signed up:', userId); // ✅ OK
console.log('User data:', userData); // ❌ Avoid
```

**5. Health Data Special Protection:**
```typescript
// HIPAA-like protections for health data
const healthData = {
  weight: encryptAtRest(weight),
  measurements: encryptAtRest(measurements),
  photos: encryptAtRest(photoUrls)
};

// Separate storage with stricter access controls
await storeHealthData(userId, healthData, {
  encryption: 'AES-256',
  accessControl: 'user-only',
  auditLog: true
});
```

---

## Conclusion & Next Steps

### Summary

This comprehensive onboarding flow design for FitCircle balances:
- **Speed** (7-9 minutes) with **thoroughness** (comprehensive setup)
- **Simplicity** (clear path) with **Personalization** (branching flows)
- **Conversion** (65% completion) with **Quality** (engaged users)
- **Delight** (animations, Fitzy) with **Performance** (<3s loads)

The design draws best practices from successful apps like StepsApp while innovating on:
- AI-powered personalization (Fitzy)
- Persona-driven branching flows
- Gamification integration (XP, achievements)
- Social-first features (FitCircles, challenges)
- Multi-metric tracking setup

### Key Differentiators from Competitors

1. **Faster to Value:** 90 seconds vs 3-5 minutes (StepsApp, HealthyWage)
2. **More Personalized:** Persona detection + branching flows
3. **Higher Engagement:** Gamification + AI coach from start
4. **Better Retention:** Social connections + challenges in onboarding
5. **Modern UX:** Dark theme, circular design, smooth animations

### Implementation Roadmap

#### Phase 1: MVP Onboarding (Weeks 1-2)
- [ ] Core flow (Screens 1-4, 7-10)
- [ ] Basic persona detection
- [ ] Fitzy introduction
- [ ] First check-in
- [ ] Dashboard setup

**Goal:** 50% completion rate, validate flow

#### Phase 2: Personalization (Weeks 3-4)
- [ ] Branching persona flows (5A, 5B, 5C)
- [ ] Challenge discovery integration
- [ ] FitCircle creation/joining
- [ ] AI coach conversation

**Goal:** 60% completion rate, improve personalization

#### Phase 3: Polish & Optimization (Weeks 5-6)
- [ ] Animations and micro-interactions
- [ ] Celebration screens
- [ ] Achievement system integration
- [ ] Dashboard tour
- [ ] Performance optimization

**Goal:** 65% completion rate, delight users

#### Phase 4: A/B Testing & Iteration (Ongoing)
- [ ] Test paywall timing
- [ ] Test quick setup option
- [ ] Test permission bundling
- [ ] Test gamification intensity
- [ ] Optimize based on data

**Goal:** 70%+ completion rate, maximize retention

### Success Metrics to Track

**Week 1 KPIs:**
- Onboarding completion rate
- Time to complete
- Screen-by-screen drop-off
- Error rates

**Week 2-4 KPIs:**
- D1 retention
- D7 retention
- Challenge join rate
- Friend invite rate
- Permission grant rates

**Month 1-3 KPIs:**
- D30 retention
- LTV of onboarded users
- Referral rates
- Paid conversion rates
- NPS scores

### Open Questions for User Research

1. **Optimal onboarding length?**
   - Test: 5 min (quick) vs 10 min (comprehensive)

2. **Paywall placement?**
   - Test: No paywall vs soft paywall vs hard paywall

3. **Persona detection accuracy?**
   - Validate: Do users behave like detected persona?

4. **Social features priority?**
   - Test: Early (Screen 5) vs late (post-dashboard) social prompts

5. **Gamification appeal?**
   - Segment: Which personas engage most with XP/levels?

### Final Recommendations

**For Launch:**
1. **Start with progressive onboarding** (Flow D)
   - Core onboarding: 5 minutes
   - Extended features: First week in-app
   - Reduces drop-off risk, maintains personalization

2. **Offer quick setup option** (Flow C)
   - 80% choose full setup
   - 20% choose quick setup
   - Both convert to engaged users

3. **Prioritize mobile experience**
   - 95% of fitness app usage is mobile
   - Test heavily on real devices
   - Optimize for iOS first, then Android

4. **Invest in Fitzy animations**
   - Strongest differentiator
   - Creates emotional connection
   - Drives brand identity

5. **Monitor drop-off at Screens 1, 5, 6**
   - Highest risk points
   - Prepare alternative strategies
   - A/B test improvements quickly

**Success Definition:**

FitCircle's onboarding is successful when:
- ✅ 65%+ users complete full onboarding
- ✅ 90 seconds to first "aha moment" (meet Fitzy)
- ✅ 55%+ join a challenge in first session
- ✅ 35%+ invite at least one friend
- ✅ 45%+ return on Day 7
- ✅ Users say: "This app gets me!"

---

**Document prepared by:** Claude (Product Manager AI)
**For:** FitCircle Team
**Date:** January 11, 2025
**Version:** 1.0
**Status:** Ready for Review & Implementation

---

## Appendix

### A. Screen Wireframe References

*[Placeholder for future wireframe links]*

### B. Copy Variations by Persona

*[Detailed copy variations for Casey, Sarah, Mike in separate doc]*

### C. Animation Specifications

*[Technical specs for Lottie animations, Framer Motion configs]*

### D. API Endpoints Required

*[List of backend endpoints needed to support onboarding]*

### E. Analytics Event Schema

*[Complete event tracking schema for onboarding funnel]*

### F. User Testing Scripts

*[Testing protocols for onboarding validation]*

---

**End of Document**
