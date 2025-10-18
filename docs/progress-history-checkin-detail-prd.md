# Progress History & Check-In Detail Enhancement PRD
**Version 1.0 | Last Updated: January 18, 2025**

---

## Executive Summary

### Vision
Transform FitCircle's progress tracking from a simple list into an engaging, visually rich experience that celebrates every milestone, provides deep insights, and fosters social accountability. This enhancement will make progress history a destination feature that users actively seek out, not just a data log they passively review.

### The Opportunity
Currently, FitCircle displays progress entries as a basic list without differentiation between weight and steps, no ability to view check-in details, and no filtering by challenge type. This creates three critical problems:

1. **Engagement Gap**: Users can't explore their journey—they see numbers but miss the story
2. **Social Disconnect**: No ability to view others' check-in details limits community engagement
3. **Type Confusion**: Mixed weight/steps data in weight-loss challenges creates cognitive load

### Expected Impact

| Metric | Current | Target (30 days) | Impact |
|--------|---------|------------------|---------|
| **Check-In Detail Views** | 0 (doesn't exist) | 8.5 views/user/week | New engagement vector |
| **Time in Progress History** | 12 sec avg | 45 sec avg | +275% session depth |
| **Social Progress Views** | 0 | 15 views/week | New social behavior |
| **Challenge Completion Rate** | 65% | 72% | +7pp from clarity |
| **7-Day Retention** | 25% | 32% | +7pp from engagement |

### Why This Matters

**For Users:**
- Celebrate progress with detailed check-in views showcasing weight, steps, mood, energy, notes
- Understand which challenge requires which data (weight vs steps)
- View friends' check-ins to stay motivated and connected
- Visually distinguish data types at a glance (purple for weight, indigo for steps)

**For Business:**
- Increased session depth and frequency drives retention
- Social features (viewing others' progress) increase viral coefficient
- Clear challenge type distinction reduces support tickets and confusion
- Premium data visualization creates upgrade motivation

---

## User Research & Personas

### Primary Users for This Feature

#### 1. Competitive Casey (40% of feature usage)
**Jobs-to-be-Done:**
- "I want to see exactly how I'm crushing my competition"
- "I need to compare my check-in details with top performers"
- "I want to spot patterns in what's working for winners"

**Pain Points:**
- Current list shows too little detail to analyze performance
- Can't see others' check-in strategies (did they walk more? eat differently?)
- Unclear what data matters for each challenge type

**Feature Priorities:**
1. Detailed leaderboard member check-ins (view others' data)
2. Visual separation of weight vs steps for strategy clarity
3. Quick filtering to see only relevant metrics

**Quote:** *"I don't just want to see numbers—I want to see what's working for people ahead of me so I can adjust my strategy."*

---

#### 2. Social Sarah (35% of feature usage)
**Jobs-to-be-Done:**
- "I want to celebrate friends' progress with comments and reactions"
- "I need to see detailed check-ins to offer genuine encouragement"
- "I want to share my own check-in stories (mood, energy, notes)"

**Pain Points:**
- Can't view friends' full check-in details (just numbers)
- No way to engage with individual check-ins socially
- Missing the emotional/contextual data (mood, notes) that build connection

**Feature Priorities:**
1. Rich check-in detail view showing mood, energy, notes
2. Ability to view friends' check-in details (if public)
3. Visual design that feels warm and encouraging (not clinical)

**Quote:** *"Numbers are fine, but I want to know how my friends are FEELING. That's what keeps us connected."*

---

#### 3. Motivated Mike (25% of feature usage)
**Jobs-to-be-Done:**
- "I want clear tracking of what data I need to log for my challenge"
- "I need to review my history to spot trends and patterns"
- "I want to understand my progress without complexity"

**Pain Points:**
- Confused about whether to log weight or steps for certain challenges
- Can't review detailed check-in to remember what worked on good days
- Too much clutter when irrelevant data types are shown

**Feature Priorities:**
1. Filtered views showing only relevant data (weight for weight-loss challenges)
2. Detailed check-in view to analyze patterns
3. Clear visual distinction between data types

**Quote:** *"Just show me what matters for my challenge. I don't need to see steps if I'm trying to lose weight."*

---

### User Pain Points Summary

**Current State Issues:**
1. **No Detail Access**: Users can't tap history items to see full check-in data
2. **Visual Confusion**: Weight and steps look identical in list view
3. **Type Mismatch**: Weight-loss challenges show steps data (and vice versa)
4. **Limited Social**: Can't view others' check-in details to engage
5. **Creation Confusion**: Challenge type selection buried in form

**Desired Outcomes:**
1. **Rich Detail Views**: Tap any check-in → see weight, steps, mood, energy, notes
2. **Visual Clarity**: Instant recognition of weight (purple) vs steps (indigo)
3. **Smart Filtering**: Only relevant data shown per challenge type
4. **Social Engagement**: View public check-ins from circle members
5. **Clear Creation**: Challenge type prominently featured during setup

---

## Feature Specifications

### A. Progress History List Redesign

#### Visual Design Specification

**List Item Types:**

**Weight Check-In Card:**
```
┌─────────────────────────────────────────────────┐
│ [Purple gradient background with scale icon]     │
│                                                   │
│ 🏋️ Weight Check-In                               │
│ 165.3 lbs          -1.2 lbs from yesterday       │
│ Today at 7:45 AM                                 │
│                                                   │
│ [Subtle mood emoji: 😊]  [Energy: ⚡⚡⚡⚡]        │
│ "Feeling great today!" [→ chevron]               │
└─────────────────────────────────────────────────┘
```

**Steps Check-In Card:**
```
┌─────────────────────────────────────────────────┐
│ [Indigo gradient background with footprint icon] │
│                                                   │
│ 👟 Steps Check-In                                │
│ 12,847 steps       128% of goal                  │
│ Today at 9:15 PM                                 │
│                                                   │
│ [Subtle mood emoji: 🎉]  [Energy: ⚡⚡⚡⚡⚡]       │
│ "New personal record!" [→ chevron]               │
└─────────────────────────────────────────────────┘
```

**Mixed Check-In Card (for custom challenges):**
```
┌─────────────────────────────────────────────────┐
│ [Dual gradient: purple left, indigo right]       │
│                                                   │
│ 📊 Daily Check-In                                │
│ 🏋️ 165.3 lbs    👟 12,847 steps                 │
│ Today at 9:30 PM                                 │
│                                                   │
│ [Mood: 😊]  [Energy: ⚡⚡⚡⚡]  [→ chevron]        │
└─────────────────────────────────────────────────┘
```

#### Technical Specifications

**Color System:**
```typescript
const CHECK_IN_COLORS = {
  weight: {
    background: 'bg-gradient-to-br from-purple-500/10 to-purple-600/5',
    border: 'border-purple-500/30',
    icon: 'text-purple-400',
    accent: 'text-purple-300',
  },
  steps: {
    background: 'bg-gradient-to-br from-indigo-500/10 to-indigo-600/5',
    border: 'border-indigo-500/30',
    icon: 'text-indigo-400',
    accent: 'text-indigo-300',
  },
  mixed: {
    background: 'bg-gradient-to-r from-purple-500/10 via-slate-900/50 to-indigo-500/10',
    border: 'border-purple-500/20 border-r-indigo-500/20',
    icon: 'text-slate-300',
    accent: 'text-slate-200',
  },
};
```

**Typography Hierarchy:**
```typescript
const TYPOGRAPHY = {
  checkInType: 'text-sm font-semibold tracking-wide uppercase',
  primaryValue: 'text-2xl sm:text-3xl font-bold',
  secondaryValue: 'text-base sm:text-lg font-medium',
  delta: 'text-sm font-medium', // change from previous
  timestamp: 'text-xs text-slate-400',
  preview: 'text-sm text-slate-300 line-clamp-1',
};
```

**Spacing & Layout:**
```typescript
const LAYOUT = {
  cardPadding: 'p-4 sm:p-5',
  cardGap: 'gap-3',
  borderRadius: 'rounded-xl',
  cardShadow: 'shadow-lg shadow-black/20',
  hoverTransform: 'hover:scale-[1.02] transition-all duration-200',
  tapFeedback: 'active:scale-[0.98]',
};
```

#### Interaction Design

**Hover State (Web Desktop):**
- Card scales to 102%
- Border glow intensifies (opacity +10%)
- Subtle lift shadow appears
- Cursor changes to pointer
- Chevron icon slides right 4px

**Tap State (Mobile):**
- Card scales to 98% (press feedback)
- Haptic feedback: light impact
- Subtle pulse animation on icon
- Border briefly flashes brighter

**Loading State:**
- Skeleton cards with shimmer animation
- Match card dimensions exactly
- Purple/indigo shimmer gradient based on expected type

**Empty State:**
```
┌─────────────────────────────────────────────────┐
│              [Large footsteps icon]              │
│                                                   │
│         No Progress Logged Yet                   │
│    Start your journey with your first check-in   │
│                                                   │
│          [Log Your First Check-In →]             │
└─────────────────────────────────────────────────┘
```

#### Filtering Logic

**Challenge Type → Displayed Data:**

| Challenge Type | Shows Weight | Shows Steps | Shows Both |
|----------------|--------------|-------------|------------|
| `weight_loss` | ✅ Only | ❌ Hidden | ❌ |
| `step_count` | ❌ Hidden | ✅ Only | ❌ |
| `workout_frequency` | ❌ Hidden | ✅ Only | ❌ |
| `custom` | ✅ | ✅ | ✅ Both |

**Implementation:**
```typescript
function filterCheckInsByType(
  checkIns: CheckIn[],
  challengeType: ChallengeType
): CheckIn[] {
  switch (challengeType) {
    case 'weight_loss':
      return checkIns.filter(c => c.weight_kg != null);
    case 'step_count':
    case 'workout_frequency':
      return checkIns.filter(c => c.steps != null);
    case 'custom':
      return checkIns; // Show all
    default:
      return checkIns;
  }
}
```

#### UI Component Structure

**Web Desktop:**
```tsx
<div className="space-y-4">
  <div className="flex items-center justify-between">
    <h3 className="text-lg font-semibold">Progress History</h3>
    <FilterDropdown /> {/* Future: filter by date range */}
  </div>

  <div className="grid gap-3">
    {filteredCheckIns.map(checkIn => (
      <CheckInCard
        key={checkIn.id}
        checkIn={checkIn}
        onClick={() => openDetailModal(checkIn)}
      />
    ))}
  </div>
</div>
```

**Mobile Web:**
```tsx
<div className="space-y-3 px-4">
  <h3 className="text-base font-semibold sticky top-0 bg-slate-950 py-2 z-10">
    Progress History
  </h3>

  <div className="space-y-2">
    {filteredCheckIns.map(checkIn => (
      <CheckInCard
        key={checkIn.id}
        checkIn={checkIn}
        compact={true}
        onClick={() => openDetailBottomSheet(checkIn)}
      />
    ))}
  </div>
</div>
```

**iOS Native:**
```swift
List {
  Section(header: Text("Progress History")) {
    ForEach(filteredCheckIns) { checkIn in
      CheckInRow(checkIn: checkIn)
        .onTapGesture {
          selectedCheckIn = checkIn
          showDetailSheet = true
        }
    }
  }
}
.sheet(isPresented: $showDetailSheet) {
  CheckInDetailView(checkIn: selectedCheckIn)
}
```

---

### B. Check-In Detail View (NEW FEATURE)

#### Complete Layout Specification

**Modal/Sheet Structure:**

**Web Desktop Modal:**
- Max width: 600px
- Height: Auto (max 90vh, scrollable)
- Background: `bg-slate-900/95` with `backdrop-blur-xl`
- Border: `border border-slate-800`
- Positioning: Center screen
- Overlay: `bg-black/60`

**Mobile Web Bottom Sheet:**
- Height: Dynamic (50vh to 90vh based on content)
- Swipe-down to dismiss
- Backdrop: `bg-black/50`
- Corner radius: Top only (`rounded-t-3xl`)
- Pull handle: Visible at top

**iOS Native Sheet:**
- Presentation: `.medium` detent (initial), `.large` (expanded)
- Haptic: Light impact on open
- Dismiss: Swipe down or tap outside
- Animation: Spring (response: 0.3, damping: 0.8)

#### Data Fields Display

**Header Section:**
```
┌─────────────────────────────────────────────────┐
│ [Type Icon] Weight Check-In                      │
│ Saturday, January 18, 2025 • 7:45 AM             │
│                                                   │
│ ╔═══════════════════════════════════════════╗   │
│ ║         165.3 lbs                          ║   │
│ ║    ↓ -1.2 lbs from yesterday               ║   │
│ ╚═══════════════════════════════════════════╝   │
└─────────────────────────────────────────────────┘
```

**Metrics Grid:**
```
┌─────────────────────────────────────────────────┐
│  ┌──────────────────┐  ┌──────────────────┐    │
│  │  😊 Mood         │  │  ⚡ Energy       │    │
│  │  Good (7/10)     │  │  High (8/10)     │    │
│  └──────────────────┘  └──────────────────┘    │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────┐    │
│  │  👟 Steps        │  │  🎯 Goal         │    │
│  │  12,847          │  │  10,000          │    │
│  │  128% ✅         │  │  +2,847          │    │
│  └──────────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────┘
```

**Notes Section:**
```
┌─────────────────────────────────────────────────┐
│ 📝 Notes                                         │
│                                                   │
│ "Had a great workout this morning! Pushed        │
│ through even though I didn't feel like it at     │
│ first. Energy is way up today. 🎉"              │
│                                                   │
│ Posted publicly to Summer Transformation          │
└─────────────────────────────────────────────────┘
```

**Progress Context:**
```
┌─────────────────────────────────────────────────┐
│ 📊 Progress in Summer Transformation             │
│                                                   │
│  Start:    180.0 lbs                             │
│  Current:  165.3 lbs    (-14.7 lbs, 73%)         │
│  Goal:     160.0 lbs    (5.3 lbs to go)          │
│                                                   │
│  [────────────●───] 73% Complete                 │
│                                                   │
│  Streak: 🔥 15 days                              │
└─────────────────────────────────────────────────┘
```

#### Field-by-Field Specification

**Date & Time:**
- Format: "Saturday, January 18, 2025 • 7:45 AM"
- Font: `text-sm text-slate-400`
- Position: Below header, aligned left

**Weight (if present):**
- Value: `text-4xl font-bold text-purple-300`
- Unit: `text-xl text-purple-400/70`
- Delta: `text-base font-medium text-green-400` (loss) or `text-red-400` (gain)
- Delta icon: `↓` (loss), `↑` (gain), `→` (maintained)

**Steps (if present):**
- Value: `text-3xl font-bold text-indigo-300`
- Unit: "steps" `text-lg text-indigo-400/70`
- Goal %: `text-base text-indigo-400` with badge if >100%
- Visual: Mini progress ring (circular, 80px diameter)

**Mood:**
- Emoji: Large (text-3xl)
- Label: "Good", "Great", "Okay", "Tired", "Stressed"
- Score: (1-10) shown as `text-sm text-slate-400`
- Color coding:
  - 8-10: Green (`text-green-400`)
  - 5-7: Yellow (`text-yellow-400`)
  - 1-4: Red (`text-red-400`)

**Energy:**
- Visual: Lightning bolts (⚡) filled based on level
- Level: 1-10 scale
- Label: "Very Low" to "Very High"
- Bolts filled: `text-orange-400`, unfilled: `text-slate-600`

**Notes:**
- Max length: 500 characters
- Font: `text-base text-slate-200 leading-relaxed`
- Background: `bg-slate-800/50 rounded-lg p-4`
- Empty state: "No notes for this check-in" `text-slate-500 italic`

**Privacy Indicator:**
- Public: 🌍 "Visible to circle members"
- Private: 🔒 "Only visible to you"
- Position: Footer, aligned right
- Font: `text-xs text-slate-500`

#### Viewing Permissions

**Own Check-Ins:**
- ✅ Always viewable (public or private)
- ✅ Can edit (weight, steps, mood, energy, notes)
- ✅ Can delete (with confirmation)
- ✅ Can toggle privacy

**Others' Check-Ins:**
- ✅ Viewable if marked public AND user is in same circle
- ❌ Hidden if marked private
- ❌ Cannot edit
- ❌ Cannot delete
- ✅ Can react (future: 👏 🔥 💪)
- ✅ Can comment (future)

**Creator/Admin:**
- ✅ Can view all check-ins (public + private) in their challenges
- ❌ Cannot edit others' data
- ✅ Can view for moderation purposes

**Implementation:**
```typescript
function canViewCheckIn(
  checkIn: CheckIn,
  viewer: User,
  challenge: Challenge
): boolean {
  // Own check-ins always viewable
  if (checkIn.user_id === viewer.id) return true;

  // Private check-ins only by owner
  if (!checkIn.is_public) {
    // Exception: challenge creator can view for moderation
    return challenge.creator_id === viewer.id;
  }

  // Public check-ins visible to circle members
  return isUserInChallenge(viewer.id, challenge.id);
}
```

#### Actions Available

**Own Check-In Actions:**
```tsx
<div className="flex gap-2 border-t border-slate-800 pt-4">
  <Button variant="outline" onClick={handleEdit}>
    <Edit className="h-4 w-4 mr-2" />
    Edit
  </Button>
  <Button variant="outline" onClick={handleTogglePrivacy}>
    {isPublic ? <Lock /> : <Globe />}
    {isPublic ? 'Make Private' : 'Make Public'}
  </Button>
  <Button variant="ghost" className="text-red-400" onClick={handleDelete}>
    <Trash className="h-4 w-4 mr-2" />
    Delete
  </Button>
</div>
```

**Others' Check-In Actions (Future Phase 2):**
```tsx
<div className="flex gap-2 border-t border-slate-800 pt-4">
  <Button variant="ghost" onClick={() => addReaction('👏')}>
    👏 {reactions.clap}
  </Button>
  <Button variant="ghost" onClick={() => addReaction('🔥')}>
    🔥 {reactions.fire}
  </Button>
  <Button variant="ghost" onClick={() => addReaction('💪')}>
    💪 {reactions.strong}
  </Button>
  <Button variant="outline" onClick={openComments}>
    <MessageCircle className="h-4 w-4 mr-2" />
    Comment
  </Button>
</div>
```

#### Platform-Specific Considerations

**Web Desktop:**
- Modal sizing: 600px max width
- Keyboard navigation:
  - `ESC`: Close modal
  - `←/→`: Navigate to prev/next check-in
  - `E`: Edit (if own)
  - `D`: Delete (if own, with confirm)
- Hover effects on action buttons
- Tooltip on privacy icon

**Mobile Web:**
- Bottom sheet presentation
- Touch targets: Min 44px
- Swipe gestures:
  - Swipe down: Dismiss
  - Swipe left/right: Prev/next check-in
- Tap outside to dismiss
- Optimized layout for narrow screens (single column)

**iOS Native:**
- Native sheet: `.medium` and `.large` detents
- Haptic feedback:
  - Light impact: On open
  - Success: On save/edit
  - Warning: On delete
  - Selection: On tab/button tap
- SF Symbols for icons:
  - Weight: `scalemass`
  - Steps: `figure.walk`
  - Mood: `face.smiling`
  - Energy: `bolt.fill`
- VoiceOver support:
  - All values announced
  - Actions clearly labeled
  - Navigation hints
- Dynamic Type: Scales with system font size
- Dark mode: Always (matches app theme)

#### Animation Specifications

**Modal Entry (Web):**
```typescript
const modalVariants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      damping: 25,
      stiffness: 300,
      duration: 0.3,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: { duration: 0.2 },
  },
};
```

**Bottom Sheet Entry (Mobile):**
```typescript
const sheetVariants = {
  hidden: { y: '100%' },
  visible: {
    y: 0,
    transition: {
      type: 'spring',
      damping: 30,
      stiffness: 300,
    },
  },
  exit: {
    y: '100%',
    transition: { duration: 0.25, ease: 'easeInOut' },
  },
};
```

**Content Stagger:**
```typescript
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};
```

**Success Celebration (on milestone):**
```typescript
// If check-in represents a milestone (e.g., 10 lbs lost, 100k steps)
const celebrationVariants = {
  initial: { scale: 1 },
  celebrate: {
    scale: [1, 1.1, 1],
    transition: { duration: 0.6, times: [0, 0.5, 1] },
  },
};

// Show confetti or sparkle animation
<Confetti active={isMilestone} />
```

---

### C. Challenge Type Filtering

#### Filtering UI/UX

**No Explicit Filter UI (Smart Default):**
- Filter automatically based on challenge type
- No user action required
- Transparent to user (just works)

**Future Enhancement (Phase 2):**
```tsx
<Tabs defaultValue="all">
  <TabsList>
    <TabsTrigger value="all">All Check-Ins</TabsTrigger>
    <TabsTrigger value="weight">
      <Scale className="h-4 w-4 mr-1" />
      Weight Only
    </TabsTrigger>
    <TabsTrigger value="steps">
      <Footprints className="h-4 w-4 mr-1" />
      Steps Only
    </TabsTrigger>
  </TabsList>
</Tabs>
```

#### Logic Implementation

**Database Query:**
```typescript
async function getFilteredCheckIns(
  userId: string,
  challengeId: string,
  challengeType: ChallengeType
): Promise<CheckIn[]> {
  const { data, error } = await supabase
    .from('daily_tracking')
    .select('*')
    .eq('user_id', userId)
    .order('tracking_date', { ascending: false });

  if (error) throw error;

  // Filter based on challenge type
  return data.filter(checkIn => {
    switch (challengeType) {
      case 'weight_loss':
        return checkIn.weight_kg != null;
      case 'step_count':
      case 'workout_frequency':
        return checkIn.steps != null;
      case 'custom':
        return true; // Show all
      default:
        return true;
    }
  });
}
```

**Client-Side Filtering:**
```typescript
const filteredCheckIns = useMemo(() => {
  if (!challenge) return allCheckIns;

  switch (challenge.type) {
    case 'weight_loss':
      return allCheckIns.filter(c => c.weight_kg != null);
    case 'step_count':
    case 'workout_frequency':
      return allCheckIns.filter(c => c.steps != null);
    case 'custom':
      return allCheckIns; // Show all data types
    default:
      return allCheckIns;
  }
}, [allCheckIns, challenge]);
```

#### Mixed/Custom Challenge Handling

**UI Presentation:**
- Show both weight AND steps in single card
- Dual-color gradient background
- Both icons visible
- Clear visual separation between metrics

**Data Validation:**
- At least ONE metric required (weight OR steps)
- Both metrics allowed but not required
- Mood and energy always optional

---

### D. Challenge Creation Flow Enhancement

#### Current State Analysis

**Problem:** Challenge type selection is buried in form, equal visual weight to other fields.

**Solution:** Elevate type selection to prominent, visual choice.

#### Enhanced Creation Flow

**Step 1: Type Selection (NEW - Prominent)**
```
┌─────────────────────────────────────────────────┐
│         What type of challenge?                  │
│    This determines what participants will track  │
│                                                   │
│  ┌─────────────────┐  ┌─────────────────┐       │
│  │  🏋️             │  │  👟             │       │
│  │  Weight Loss    │  │  Step Count     │       │
│  │  Track weight   │  │  Track steps    │       │
│  │  progress daily │  │  daily          │       │
│  │                 │  │                 │       │
│  │  [Select]       │  │  [Select]       │       │
│  └─────────────────┘  └─────────────────┘       │
│                                                   │
│  ┌─────────────────┐  ┌─────────────────┐       │
│  │  ⏱️             │  │  ⭐             │       │
│  │  Workout Time   │  │  Custom Goal    │       │
│  │  Track workout  │  │  Track multiple │       │
│  │  minutes        │  │  metrics        │       │
│  │                 │  │                 │       │
│  │  [Select]       │  │  [Select]       │       │
│  └─────────────────┘  └─────────────────┘       │
└─────────────────────────────────────────────────┘
```

**Visual Specifications:**
- Card size: 200px x 240px (desktop), 150px x 180px (mobile)
- Grid: 2x2 on desktop, 1x4 on mobile
- Background: `bg-slate-800/50` (default), `bg-purple-500/20` (selected)
- Border: `border-2 border-transparent` → `border-purple-500` (selected)
- Icon size: 48px (desktop), 36px (mobile)
- Font:
  - Title: `text-lg font-bold`
  - Description: `text-sm text-slate-400`

**Interaction:**
- Single selection (radio behavior)
- Hover: Card lifts, border glows
- Selected: Checkmark appears, border highlights
- Click anywhere on card to select

**Educational Content:**
```tsx
<div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-6">
  <div className="flex gap-3">
    <InfoIcon className="h-5 w-5 text-blue-400 flex-shrink-0" />
    <div className="text-sm text-blue-300">
      <strong>Not sure which to choose?</strong>
      <ul className="mt-2 space-y-1 text-blue-200/90">
        <li>• <strong>Weight Loss:</strong> Best for challenges focused on losing pounds/kg</li>
        <li>• <strong>Step Count:</strong> Perfect for walking/activity challenges</li>
        <li>• <strong>Workout Time:</strong> Ideal for building exercise habits</li>
        <li>• <strong>Custom:</strong> Track multiple metrics for comprehensive fitness</li>
      </ul>
    </div>
  </div>
</div>
```

**Step 2: Challenge Details (Existing, Enhanced)**
- Name, description, dates (existing)
- Preview of what participants will track:
```tsx
{challengeType === 'weight_loss' && (
  <div className="bg-purple-500/10 p-4 rounded-lg">
    <p className="text-sm text-purple-300">
      ✅ Participants will log: <strong>Weight</strong>, Mood, Energy, Notes
    </p>
  </div>
)}

{challengeType === 'step_count' && (
  <div className="bg-indigo-500/10 p-4 rounded-lg">
    <p className="text-sm text-indigo-300">
      ✅ Participants will log: <strong>Steps</strong>, Mood, Energy, Notes
    </p>
  </div>
)}

{challengeType === 'custom' && (
  <div className="bg-slate-700/50 p-4 rounded-lg">
    <p className="text-sm text-slate-300">
      ✅ Participants will log: <strong>Weight, Steps</strong>, Mood, Energy, Notes
    </p>
  </div>
)}
```

**Step 3: Settings (Existing)**
- Visibility, max participants, dates (unchanged)

#### Mobile Web Considerations

**Wizard Flow:**
- Single-column layout
- One choice per screen
- Swipe left/right to view options
- Large touch targets (min 44px)
- Bottom navigation: [Back] [Continue]

**Progressive Disclosure:**
- Show type selection first
- Expand details only after selection
- Clear progress indicator (1/3, 2/3, 3/3)

#### iOS Native Enhancements

**Card Selection:**
- Haptic feedback on selection (medium impact)
- SF Symbols for icons:
  - Weight Loss: `scalemass.fill`
  - Step Count: `figure.walk`
  - Workout Time: `stopwatch.fill`
  - Custom: `slider.horizontal.3`

**Educational Sheet:**
- Bottom sheet with "Learn More" button
- Examples of each challenge type
- Success stories for each type

---

### E. Platform-Specific Details

#### Web Desktop

**Check-In Detail Modal:**
- Size: 600px max width, auto height (max 90vh)
- Position: Center screen with overlay
- Close: ESC key, click overlay, X button
- Keyboard navigation:
  - Tab: Navigate between fields/actions
  - Arrow keys: Navigate between check-ins
  - E: Edit (if own)
  - Delete: Delete (if own, confirm first)

**Progress History List:**
- Grid layout: Single column
- Infinite scroll (load 20 at a time)
- Sticky header with date filter
- Hover effects:
  - Card lift (translateY -4px)
  - Border glow
  - Cursor pointer
  - Chevron slide right

**Performance:**
- Virtualize list for 100+ items (react-window)
- Lazy load images
- Debounce scroll events
- Prefetch next/prev check-in on hover

#### Mobile Web

**Check-In Detail Bottom Sheet:**
- Height: Starts at 50vh, expands to 90vh
- Pull handle at top (visible indicator)
- Swipe down to dismiss
- Backdrop: `bg-black/50` with tap to dismiss
- Corner radius: Top only (`rounded-t-3xl`)

**Progress History List:**
- Vertical scroll
- Pull-to-refresh
- Touch targets: Min 44px height
- Swipe gestures:
  - Swipe left on card: Quick actions (edit, delete)
  - Swipe right: Mark as favorite (future)
- Optimized for thumb reach (actions at bottom)

**Performance:**
- Intersection Observer for lazy load
- Touch event optimization (passive listeners)
- Reduce motion for accessibility
- Service worker for offline caching

#### iOS Native

**Check-In Detail Sheet:**
```swift
.sheet(isPresented: $showDetail) {
  CheckInDetailView(checkIn: selectedCheckIn)
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
}
```

**Haptic Feedback:**
```swift
// On check-in tap
let impact = UIImpactFeedbackGenerator(style: .light)
impact.impactOccurred()

// On milestone celebration
let notification = UINotificationFeedbackGenerator()
notification.notificationOccurred(.success)

// On delete
let impact = UIImpactFeedbackGenerator(style: .heavy)
impact.impactOccurred()
```

**SF Symbols:**
- Weight: `scalemass.fill`
- Steps: `figure.walk`
- Mood: `face.smiling.fill`
- Energy: `bolt.fill`
- Notes: `note.text`
- Lock: `lock.fill`
- Globe: `globe`

**VoiceOver:**
```swift
.accessibilityLabel("Weight check-in, 165.3 pounds, down 1.2 pounds from yesterday")
.accessibilityHint("Double tap to view full details")
.accessibilityAddTraits(.isButton)
```

**Dynamic Type:**
- All text scales with system preference
- Layout adapts to larger text (stacks vertically if needed)
- Min/max constraints prevent breaking

**Dark Mode:**
- Forced dark theme (matches app)
- High contrast mode support
- Increased contrast option available

---

## Information Architecture

### Data Model

**Existing `daily_tracking` table (no changes needed):**
```sql
CREATE TABLE daily_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tracking_date DATE NOT NULL,
  weight_kg DECIMAL(5,2) CHECK (weight_kg > 0 AND weight_kg < 1000),
  steps INTEGER CHECK (steps >= 0),
  mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 10),
  energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tracking_date)
);
```

**New `check_in_privacy` field (add to daily_tracking):**
```sql
ALTER TABLE daily_tracking
ADD COLUMN is_public BOOLEAN DEFAULT true;

CREATE INDEX idx_daily_tracking_public
ON daily_tracking(is_public) WHERE is_public = true;
```

**New `check_in_reactions` table (Phase 2):**
```sql
CREATE TABLE check_in_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id UUID NOT NULL REFERENCES daily_tracking(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type VARCHAR(20) NOT NULL CHECK (reaction_type IN ('clap', 'fire', 'strong', 'heart')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(check_in_id, user_id, reaction_type)
);

CREATE INDEX idx_check_in_reactions_check_in
ON check_in_reactions(check_in_id);
```

### Required vs Optional Fields

**Per Challenge Type:**

| Field | Weight Loss | Step Count | Workout Time | Custom |
|-------|-------------|------------|--------------|--------|
| `tracking_date` | ✅ Required | ✅ Required | ✅ Required | ✅ Required |
| `weight_kg` | ✅ Required | ❌ Optional | ❌ Optional | ❌ Optional |
| `steps` | ❌ Optional | ✅ Required | ❌ Optional | ❌ Optional |
| `mood_score` | ❌ Optional | ❌ Optional | ❌ Optional | ❌ Optional |
| `energy_level` | ❌ Optional | ❌ Optional | ❌ Optional | ❌ Optional |
| `notes` | ❌ Optional | ❌ Optional | ❌ Optional | ❌ Optional |
| `is_public` | ✅ Default true | ✅ Default true | ✅ Default true | ✅ Default true |

**Validation Rules:**

```typescript
function validateCheckIn(
  checkIn: Partial<CheckIn>,
  challengeType: ChallengeType
): ValidationResult {
  const errors: string[] = [];

  // Date always required
  if (!checkIn.tracking_date) {
    errors.push('Date is required');
  }

  // Type-specific requirements
  switch (challengeType) {
    case 'weight_loss':
      if (checkIn.weight_kg == null) {
        errors.push('Weight is required for weight loss challenges');
      }
      break;
    case 'step_count':
    case 'workout_frequency':
      if (checkIn.steps == null) {
        errors.push('Steps are required for this challenge type');
      }
      break;
    case 'custom':
      // At least one metric required
      if (checkIn.weight_kg == null && checkIn.steps == null) {
        errors.push('At least weight or steps must be provided');
      }
      break;
  }

  // Range validations
  if (checkIn.mood_score != null && (checkIn.mood_score < 1 || checkIn.mood_score > 10)) {
    errors.push('Mood score must be between 1 and 10');
  }

  if (checkIn.energy_level != null && (checkIn.energy_level < 1 || checkIn.energy_level > 10)) {
    errors.push('Energy level must be between 1 and 10');
  }

  if (checkIn.notes != null && checkIn.notes.length > 500) {
    errors.push('Notes must be 500 characters or less');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

### API Endpoints

**Get Filtered Check-Ins:**
```typescript
// GET /api/challenges/[id]/check-ins
// Query params: ?userId=xxx&limit=20&offset=0

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, limit = 20, offset = 0 } = request.nextUrl.searchParams;

  // Get challenge to determine type
  const { data: challenge } = await supabase
    .from('challenges')
    .select('type')
    .eq('id', params.id)
    .single();

  // Get check-ins with filtering
  const checkIns = await getFilteredCheckIns(
    userId,
    params.id,
    challenge.type
  );

  return NextResponse.json({
    checkIns: checkIns.slice(offset, offset + limit),
    hasMore: checkIns.length > offset + limit,
  });
}
```

**Get Single Check-In Detail:**
```typescript
// GET /api/check-ins/[id]

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser(request);

  const { data: checkIn } = await supabase
    .from('daily_tracking')
    .select(`
      *,
      profiles:user_id (
        username,
        display_name,
        avatar_url
      )
    `)
    .eq('id', params.id)
    .single();

  // Check view permission
  if (!canViewCheckIn(checkIn, user, challenge)) {
    return NextResponse.json(
      { error: 'Not authorized to view this check-in' },
      { status: 403 }
    );
  }

  return NextResponse.json({ checkIn });
}
```

**Update Check-In Privacy:**
```typescript
// PATCH /api/check-ins/[id]/privacy

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser(request);
  const { isPublic } = await request.json();

  const { error } = await supabase
    .from('daily_tracking')
    .update({ is_public: isPublic })
    .eq('id', params.id)
    .eq('user_id', user.id); // Ensure ownership

  if (error) throw error;

  return NextResponse.json({ success: true });
}
```

**Delete Check-In:**
```typescript
// DELETE /api/check-ins/[id]

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser(request);

  const { error } = await supabase
    .from('daily_tracking')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id); // Ensure ownership

  if (error) throw error;

  return NextResponse.json({ success: true });
}
```

---

## Engagement & Delight

### How to Make This Premium & Fun

#### 1. Celebration Animations for Milestones

**Trigger Conditions:**
- First check-in ever → 🎉 "Welcome to your journey!"
- 7-day streak → 🔥 "On fire! 7 days strong!"
- 10 lbs lost → 🏆 "Double digits! Amazing!"
- 50k steps in day → 💪 "Step champion!"
- 30 check-ins total → ⭐ "Consistency master!"

**Animation Spec:**
```typescript
<AnimatePresence>
  {isMilestone && (
    <motion.div
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: 'spring', duration: 0.8 }}
      className="absolute inset-0 pointer-events-none"
    >
      <Confetti
        numberOfPieces={50}
        recycle={false}
        colors={['#a855f7', '#6366f1', '#10b981', '#f59e0b']}
      />

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 0.6, times: [0, 0.5, 1] }}
          className="text-6xl"
        >
          {milestoneEmoji}
        </motion.div>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-xl font-bold text-center mt-4"
        >
          {milestoneMessage}
        </motion.p>
      </div>
    </motion.div>
  )}
</AnimatePresence>
```

#### 2. Progress Visualizations

**Mini Sparkline in List View:**
```tsx
// Show 7-day weight trend as tiny line chart
<Sparklines data={last7DaysWeight} width={80} height={20}>
  <SparklinesLine
    color="#a855f7"
    style={{ strokeWidth: 2, fill: 'none' }}
  />
</Sparklines>
```

**Circular Progress Ring (Detail View):**
```tsx
<CircularProgress
  value={progressPercentage}
  size={120}
  strokeWidth={12}
  color="purple"
  className="mx-auto"
>
  <div className="text-center">
    <p className="text-3xl font-bold">{progressPercentage}%</p>
    <p className="text-xs text-slate-400">to goal</p>
  </div>
</CircularProgress>
```

**Mood/Energy Visualization:**
```tsx
// Mood trend over last 7 days
<div className="flex items-end gap-1 h-12">
  {last7DaysMood.map((mood, i) => (
    <motion.div
      key={i}
      initial={{ height: 0 }}
      animate={{ height: `${mood * 10}%` }}
      transition={{ delay: i * 0.05 }}
      className={`flex-1 rounded-t ${getMoodColor(mood)}`}
    />
  ))}
</div>
```

#### 3. Social Features (Phase 2)

**Reactions:**
- Tap to react: 👏 🔥 💪 ❤️
- Animated reaction bubble pops up
- Show reaction count with avatars
- Notification when someone reacts to your check-in

**Comments:**
```tsx
<div className="border-t border-slate-800 pt-4 mt-4">
  <h4 className="font-semibold mb-3">Comments</h4>
  <div className="space-y-3">
    {comments.map(comment => (
      <div key={comment.id} className="flex gap-3">
        <Avatar size="sm">
          <AvatarImage src={comment.user.avatar_url} />
          <AvatarFallback>{comment.user.initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="text-sm">
            <strong>{comment.user.display_name}</strong>
            <span className="text-slate-400 ml-2">{comment.timestamp}</span>
          </p>
          <p className="text-sm text-slate-300 mt-1">{comment.text}</p>
        </div>
      </div>
    ))}
  </div>

  <div className="flex gap-2 mt-3">
    <Input
      placeholder="Add a comment..."
      value={newComment}
      onChange={e => setNewComment(e.target.value)}
    />
    <Button onClick={handlePostComment}>Post</Button>
  </div>
</div>
```

#### 4. Gamification

**Badges in Detail View:**
```tsx
{hasStreak7 && <Badge variant="success">🔥 7-Day Streak</Badge>}
{hasLost10lbs && <Badge variant="success">🏆 10 lbs Lost</Badge>}
{hasWalked50k && <Badge variant="success">💪 50K Steps</Badge>}
```

**XP Earned Display:**
```tsx
<motion.div
  initial={{ scale: 0, rotate: -45 }}
  animate={{ scale: 1, rotate: 0 }}
  className="absolute top-2 right-2 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-bold"
>
  +50 XP
</motion.div>
```

#### 5. Delightful Empty States

**No Check-Ins Yet:**
```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  className="text-center py-12"
>
  <motion.div
    animate={{ y: [0, -10, 0] }}
    transition={{ repeat: Infinity, duration: 2 }}
  >
    <Footprints className="h-20 w-20 text-slate-600 mx-auto mb-4" />
  </motion.div>
  <h3 className="text-xl font-bold mb-2">Start Your Journey</h3>
  <p className="text-slate-400 mb-6">
    Log your first check-in to begin tracking your progress
  </p>
  <Button size="lg" onClick={openCheckInModal}>
    <Plus className="h-5 w-5 mr-2" />
    Log First Check-In
  </Button>
</motion.div>
```

#### 6. Smooth, Satisfying Animations

**Card Entry Stagger:**
```typescript
const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', damping: 20 },
  },
};

<motion.div variants={containerVariants} initial="hidden" animate="visible">
  {checkIns.map(checkIn => (
    <motion.div key={checkIn.id} variants={cardVariants}>
      <CheckInCard checkIn={checkIn} />
    </motion.div>
  ))}
</motion.div>
```

**Swipe-to-Delete (Mobile):**
```tsx
<motion.div
  drag="x"
  dragConstraints={{ left: -100, right: 0 }}
  onDragEnd={(e, info) => {
    if (info.offset.x < -80) {
      handleDelete();
    }
  }}
  className="relative"
>
  <CheckInCard />
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: dragX < -20 ? 1 : 0 }}
    className="absolute right-0 top-0 bottom-0 w-20 bg-red-500 flex items-center justify-center"
  >
    <Trash className="h-5 w-5 text-white" />
  </motion.div>
</motion.div>
```

#### 7. Easter Eggs & Surprises

**Perfect Week:**
- If user logs check-ins all 7 days: Special "Perfect Week" badge
- Unlock exclusive avatar border

**Late Night Warrior:**
- Check-in after 11pm: "Night Owl" badge
- Special dark moon icon

**Early Bird:**
- Check-in before 6am: "Early Bird" badge
- Special sunrise icon

**Consistency Combo:**
- 3 days in a row: +10 bonus XP
- 7 days in a row: +50 bonus XP
- 30 days in a row: +200 bonus XP + special animation

---

## Implementation Roadmap

### Phase 1: MVP (2 weeks) - Core Functionality

**Sprint 1 (Week 1): Data & Backend**

**User Stories:**

1. **As a user, I can tap a progress history item to view full check-in details**
   - Acceptance Criteria:
     - ✅ Tap/click on any history card opens detail modal/sheet
     - ✅ Modal displays weight, steps, mood, energy, notes
     - ✅ Modal displays date, time, and privacy status
     - ✅ Close modal with ESC (desktop), swipe down (mobile), tap outside
   - Technical Tasks:
     - Create `CheckInDetailModal` component
     - Create `CheckInDetailSheet` component (mobile)
     - Add onClick handler to history cards
     - Implement modal/sheet state management
   - Success Metrics:
     - Modal opens in <200ms
     - 80%+ of users who view history also view detail
     - Zero console errors on open/close

2. **As a user, I see visually distinct weight and steps check-ins**
   - Acceptance Criteria:
     - ✅ Weight check-ins have purple gradient background
     - ✅ Steps check-ins have indigo gradient background
     - ✅ Icons clearly indicate type (scale vs footprints)
     - ✅ Mixed check-ins have dual-gradient background
   - Technical Tasks:
     - Create `CheckInCard` component with type variants
     - Implement color system constants
     - Add icons from lucide-react
     - Apply gradient backgrounds via Tailwind
   - Success Metrics:
     - 95%+ users correctly identify check-in type in 5-second test
     - Consistent rendering across browsers
     - Accessible color contrast (WCAG AA)

3. **As a user, I only see relevant check-ins for my challenge type**
   - Acceptance Criteria:
     - ✅ Weight-loss challenges show only weight check-ins
     - ✅ Step-count challenges show only steps check-ins
     - ✅ Custom challenges show all check-ins
     - ✅ Filter applies automatically (no user action needed)
   - Technical Tasks:
     - Implement `filterCheckInsByType()` utility
     - Add challenge type context to history view
     - Update API endpoint to return filtered data
     - Add unit tests for filtering logic
   - Success Metrics:
     - Zero irrelevant check-ins shown
     - Filter executes in <50ms
     - 100% test coverage on filtering logic

**Sprint 2 (Week 2): UI & Interactions**

4. **As a user, I can view my own check-in details with edit/delete options**
   - Acceptance Criteria:
     - ✅ Detail modal shows "Edit" and "Delete" buttons for own check-ins
     - ✅ Edit opens check-in in edit mode
     - ✅ Delete shows confirmation dialog
     - ✅ Privacy toggle available (public/private)
   - Technical Tasks:
     - Add action buttons to detail modal
     - Implement edit functionality (navigate to edit view)
     - Implement delete with confirmation
     - Add privacy toggle component
     - Create DELETE /api/check-ins/[id] endpoint
     - Create PATCH /api/check-ins/[id]/privacy endpoint
   - Success Metrics:
     - Edit/delete success rate: 95%+
     - Confirmation prevents accidental deletions
     - Privacy toggle reflects immediately

5. **As a challenge creator, I can emphasize challenge type during creation**
   - Acceptance Criteria:
     - ✅ Type selection appears as first/prominent step
     - ✅ Large, visual cards for each type
     - ✅ Educational content explains each type
     - ✅ Preview of what participants will track
   - Technical Tasks:
     - Redesign `FitCircleCreator` type selection step
     - Create large card components for each type
     - Add educational tooltip/info section
     - Add tracking preview below selection
   - Success Metrics:
     - Type selection clarity: 90%+ in user testing
     - Reduced "wrong type" support tickets
     - Increased challenge creation completion rate

6. **As a user viewing others' check-ins, I see public data only**
   - Acceptance Criteria:
     - ✅ Public check-ins viewable by circle members
     - ✅ Private check-ins hidden (or show "Private" placeholder)
     - ✅ No edit/delete buttons on others' check-ins
     - ✅ User avatar and name displayed
   - Technical Tasks:
     - Implement permission check: `canViewCheckIn()`
     - Add user profile data to check-in query
     - Hide action buttons for non-owners
     - Add "Private Check-In" placeholder card
   - Success Metrics:
     - Zero unauthorized data access
     - Social views increase by 200%+
     - Privacy violations: 0

**Technical Dependencies:**
- ✅ Existing `daily_tracking` table
- ✅ Existing `challenges` table with `type` field
- ✅ Existing Radix UI Dialog component
- ✅ Framer Motion for animations
- 🔲 Add `is_public` column to `daily_tracking`

**Risk Mitigation:**
- **Risk:** Performance issues with large check-in lists
  - **Mitigation:** Implement pagination (20 per page), virtualization if >100 items
- **Risk:** Privacy concerns with social viewing
  - **Mitigation:** Default to public but prominent privacy toggle, clear indicators
- **Risk:** User confusion about filtering
  - **Mitigation:** A/B test with/without explicit filter UI, measure comprehension

**Phase 1 Success Metrics:**
- ✅ Check-in detail views: 5+ per user per week
- ✅ Time in progress history: 30+ seconds avg
- ✅ Social progress views: 8+ per week
- ✅ Zero critical bugs in production
- ✅ 90%+ feature adoption within 7 days

---

### Phase 2: Enhanced Features (2 weeks)

**Sprint 3 (Week 3): Social Engagement**

7. **As a user, I can react to others' check-ins**
   - Acceptance Criteria:
     - ✅ Four reaction types: 👏 🔥 💪 ❤️
     - ✅ Tap reaction to add/remove
     - ✅ See reaction count and who reacted
     - ✅ Receive notification when someone reacts to my check-in
   - Technical Tasks:
     - Create `check_in_reactions` table
     - Build reaction button component
     - Implement POST /api/check-ins/[id]/reactions
     - Add real-time reaction updates (Supabase Realtime)
     - Create notification on reaction
   - Success Metrics:
     - 40%+ of detail views result in reaction
     - Reactions per check-in: 2.5 avg
     - DAU increase: +15%

8. **As a user, I can comment on check-ins**
   - Acceptance Criteria:
     - ✅ Comment input field in detail view
     - ✅ Comments display with avatar, name, timestamp
     - ✅ Edit/delete own comments
     - ✅ Notification on new comment
   - Technical Tasks:
     - Create `check_in_comments` table
     - Build comment list and input components
     - Implement POST /api/check-ins/[id]/comments
     - Add real-time comment updates
     - Create notification system
   - Success Metrics:
     - 20%+ of check-ins receive comments
     - Comments per check-in: 1.8 avg
     - Session duration increase: +25%

9. **As a user, I see progress visualizations in detail view**
   - Acceptance Criteria:
     - ✅ 7-day trend sparkline for weight/steps
     - ✅ Circular progress ring for challenge goal
     - ✅ Mood/energy bar chart over time
     - ✅ Comparison to personal best
   - Technical Tasks:
     - Integrate Recharts library
     - Create mini chart components
     - Fetch 7-day historical data
     - Calculate personal bests
   - Success Metrics:
     - Visual engagement: 70%+ users interact with charts
     - Time in detail view: +40%
     - "Aha moments" reported in feedback

**Sprint 4 (Week 4): Delight & Polish**

10. **As a user, I see celebration animations for milestones**
    - Acceptance Criteria:
      - ✅ Confetti animation on milestone check-ins
      - ✅ Badge awards appear with animation
      - ✅ Haptic feedback on milestone (mobile)
      - ✅ Milestone messages appear in detail view
    - Technical Tasks:
      - Implement milestone detection logic
      - Add react-confetti library
      - Create badge animation components
      - Add haptic feedback (iOS/Android)
    - Success Metrics:
      - Milestone screenshots shared: 30%+
      - Retention boost on milestone days: +20%
      - NPS increase from delight: +10 points

11. **As a user, I experience smooth, satisfying animations**
    - Acceptance Criteria:
      - ✅ Staggered card entry animations
      - ✅ Smooth modal open/close transitions
      - ✅ Swipe gestures feel natural (mobile)
      - ✅ Reduced motion option respects preference
    - Technical Tasks:
      - Fine-tune Framer Motion variants
      - Add spring physics to interactions
      - Implement swipe-to-delete (mobile)
      - Add prefers-reduced-motion check
    - Success Metrics:
      - Animation performance: 60fps
      - User delight score: 8/10+
      - Zero jank reports

12. **As a user, I can navigate between check-ins quickly**
    - Acceptance Criteria:
      - ✅ Arrow keys navigate prev/next (desktop)
      - ✅ Swipe left/right navigates (mobile)
      - ✅ Visual indicator of position (3 of 15)
      - ✅ Prefetch adjacent check-ins
    - Technical Tasks:
      - Add keyboard event listeners
      - Implement swipe gesture detection
      - Add position indicator component
      - Prefetch logic for adjacent data
    - Success Metrics:
      - Multi-check-in viewing: 40%+ sessions
      - Navigation speed: <300ms
      - Prefetch hit rate: 80%+

**Phase 2 Success Metrics:**
- ✅ Social engagement rate: 50%+ (reactions or comments)
- ✅ Average check-ins viewed per session: 4+
- ✅ Session duration: 60+ seconds avg
- ✅ NPS increase: +15 points
- ✅ Viral coefficient: +0.2 (from social features)

---

### Phase 3: Advanced Features (3 weeks)

**Sprint 5 (Week 5): Advanced Filtering & Search**

13. **As a user, I can filter check-ins by date range**
    - Acceptance Criteria:
      - ✅ Date range picker (last 7 days, 30 days, custom)
      - ✅ Filter applies immediately
      - ✅ Clear visual feedback of active filter
    - Technical Tasks:
      - Add date range filter component
      - Update API to support date filtering
      - Add filter state management
    - Success Metrics:
      - Filter usage: 30%+ of sessions
      - Insights discovered through filtering

14. **As a user, I can search check-in notes**
    - Acceptance Criteria:
      - ✅ Search input with debounce
      - ✅ Highlights matching text
      - ✅ Results update as I type
    - Technical Tasks:
      - Add full-text search to notes
      - Create search UI component
      - Implement highlight logic
    - Success Metrics:
      - Search usage: 15%+ of power users
      - Average search queries: 2.3 per session

**Sprint 6-7 (Week 6-7): Insights & Analytics**

15. **As a user, I see personalized insights from my check-in history**
    - Acceptance Criteria:
      - ✅ "Best day of week" analysis
      - ✅ Mood/energy correlation insights
      - ✅ Weight loss velocity trends
      - ✅ Actionable recommendations
    - Technical Tasks:
      - Build analytics engine
      - Create insight card components
      - Implement ML-based recommendations (simple)
    - Success Metrics:
      - Insight engagement: 60%+ click-through
      - Behavior change from insights: 25%
      - Retention increase: +10%

16. **As a challenge creator, I see aggregated check-in analytics**
    - Acceptance Criteria:
      - ✅ Participant check-in compliance rate
      - ✅ Average progress across circle
      - ✅ Most active days/times
      - ✅ Export data as CSV
    - Technical Tasks:
      - Build admin analytics dashboard
      - Create aggregation queries
      - Add CSV export functionality
    - Success Metrics:
      - Creator engagement with analytics: 70%+
      - Data-driven challenge adjustments: 40%

**Phase 3 Success Metrics:**
- ✅ Power user retention: 85%+
- ✅ Feature discovery: 60%+ use advanced features
- ✅ Creator satisfaction: NPS 80+
- ✅ Premium upgrade consideration: +20%

---

## Success Metrics & KPIs

### North Star Metric
**Check-In Detail Engagement Rate**: % of users who view check-in details at least once per week

**Target:** 70% of WAU (Weekly Active Users)

**Why this metric:**
- Indicates deep engagement with progress history
- Correlates with retention and completion
- Drives social behavior (viewing others' check-ins)
- Differentiates power users from casual users

---

### Leading Indicators

#### Engagement Metrics

| Metric | Baseline | 7-Day Target | 30-Day Target | Measurement |
|--------|----------|--------------|---------------|-------------|
| **Check-In Detail Views** | 0 | 3.5/user/week | 8.5/user/week | Mixpanel event: `check_in_detail_viewed` |
| **Time in Detail View** | 0 | 18 sec avg | 35 sec avg | Session duration tracking |
| **History List Views** | 4.2/user/week | 6.5/user/week | 10/user/week | Mixpanel event: `history_viewed` |
| **Social Check-In Views** | 0 | 5/user/week | 15/user/week | Event: `other_user_checkin_viewed` |
| **Privacy Toggle Actions** | N/A | 0.3/user/week | 0.8/user/week | Event: `privacy_toggled` |

#### Completion Metrics

| Metric | Baseline | 7-Day Target | 30-Day Target | Measurement |
|--------|----------|--------------|---------------|-------------|
| **Challenge Completion Rate** | 65% | 67% | 72% | % of challenges where user finishes |
| **Check-In Frequency** | 4.8/week | 5.2/week | 5.8/week | Avg check-ins per active user |
| **Streak Maintenance** | 45% | 50% | 60% | % maintaining 7+ day streaks |
| **Challenge Type Clarity** | N/A | 85% | 95% | User survey: "I know what to track" |

#### Social Metrics (Phase 2+)

| Metric | Baseline | 7-Day Target | 30-Day Target | Measurement |
|--------|----------|--------------|---------------|-------------|
| **Reaction Rate** | 0 | 30% | 50% | % of detail views → reaction |
| **Comment Rate** | 0 | 12% | 20% | % of detail views → comment |
| **Social Views per User** | 0 | 8/week | 20/week | Viewing others' check-ins |
| **Reactions Received** | 0 | 2.5/check-in | 4/check-in | Avg reactions per check-in |

---

### Lagging Indicators

#### Retention Impact

| Metric | Baseline | Target (30-day) | Impact | Measurement |
|--------|----------|-----------------|--------|-------------|
| **D1 Retention** | 40% | 45% | +5pp | % returning day after signup |
| **D7 Retention** | 25% | 32% | +7pp | % active after 7 days |
| **D30 Retention** | 15% | 20% | +5pp | % active after 30 days |
| **Churn Rate** | 71% (90-day) | 62% (90-day) | -9pp | % who stop using |

**Why retention improves:**
- Deeper engagement with check-in details creates investment
- Social viewing creates community bonds
- Clear challenge type reduces confusion/frustration
- Milestone celebrations create memorable moments

#### Business Impact

| Metric | Baseline | Target (90-day) | Impact | Calculation |
|--------|----------|-----------------|--------|-------------|
| **LTV (Lifetime Value)** | $85 | $102 | +20% | Avg revenue per user over lifetime |
| **Session Frequency** | 8.5/week | 11/week | +29% | Avg sessions per active user |
| **Session Duration** | 6.2 min | 8.5 min | +37% | Avg time per session |
| **Viral Coefficient** | 0.4 | 0.6 | +0.2 | Social features drive invites |
| **Premium Conversion** | 15% | 19% | +4pp | Upgraded features as motivation |

**Revenue Impact Calculation:**
```
Current MRR: $150K (baseline)
Users: 20,000 MAU

Post-Enhancement (90 days):
- Retention improvement: +7pp D7, +5pp D30
- LTV increase: +20% ($85 → $102)
- Premium conversion: +4pp (15% → 19%)

New MRR = 20,000 × 0.20 (retention) × 0.19 (conversion) × $9.99
New MRR = $75,924 (from this cohort alone)

Projected Total MRR (with growth): $180K (+20%)
```

---

### Qualitative Metrics

#### User Feedback Themes

**Measure via:**
- In-app NPS survey (post-detail view)
- User interviews (n=20 per sprint)
- Support ticket analysis
- App store reviews

**Success Criteria:**

| Theme | Target Sentiment | Quotes to Track |
|-------|------------------|-----------------|
| **Feature Discoverability** | 85%+ "easy to find" | "I love tapping to see details" |
| **Visual Clarity** | 90%+ "clear distinction" | "Purple for weight makes total sense" |
| **Social Connection** | 70%+ "feel connected" | "Seeing my friend's progress motivates me" |
| **Celebration/Delight** | 75%+ "fun to use" | "The confetti made my day!" |
| **Information Density** | 80%+ "right amount" | "Perfect level of detail" |

#### NPS Score

**Current Baseline:** 50 (FitCircle overall)
**Target (30-day):** 58 (+8 points)
**Target (90-day):** 65 (+15 points)

**NPS Question:**
"How likely are you to recommend FitCircle's progress tracking to a friend?"
- 0-6: Detractors
- 7-8: Passives
- 9-10: Promoters

**Follow-up Question:**
"What did you love most about viewing your check-in details?"

---

### Instrumentation Plan

#### Events to Track

**Mixpanel Events:**
```typescript
// Core engagement
trackEvent('history_viewed', {
  challenge_id: string,
  challenge_type: ChallengeType,
  check_in_count: number,
  source: 'dashboard' | 'challenge_detail' | 'profile',
});

trackEvent('check_in_detail_viewed', {
  check_in_id: string,
  check_in_type: 'weight' | 'steps' | 'mixed',
  is_own: boolean,
  view_duration_seconds: number,
  source: 'history_list' | 'notification' | 'leaderboard',
});

trackEvent('check_in_detail_action', {
  check_in_id: string,
  action: 'edit' | 'delete' | 'toggle_privacy' | 'navigate_next' | 'navigate_prev',
  success: boolean,
});

// Social engagement (Phase 2)
trackEvent('check_in_reaction_added', {
  check_in_id: string,
  reaction_type: 'clap' | 'fire' | 'strong' | 'heart',
  is_own_checkin: boolean,
});

trackEvent('check_in_comment_posted', {
  check_in_id: string,
  comment_length: number,
  is_own_checkin: boolean,
});

// Challenge creation
trackEvent('challenge_type_selected', {
  challenge_type: ChallengeType,
  source: 'create_dialog' | 'wizard',
  time_to_select_seconds: number,
});

trackEvent('challenge_created', {
  challenge_type: ChallengeType,
  has_educational_content_viewed: boolean,
  creation_time_seconds: number,
});
```

**User Properties:**
```typescript
setUserProperty('total_detail_views', count);
setUserProperty('avg_detail_view_duration', seconds);
setUserProperty('social_views_count', count);
setUserProperty('reactions_given', count);
setUserProperty('comments_posted', count);
setUserProperty('last_detail_view_date', timestamp);
```

#### Dashboard Metrics

**Real-Time Dashboard (for PMs):**
- Detail views per hour (last 24h)
- Avg time in detail view (rolling 7-day)
- Social engagement rate (% of views → reaction/comment)
- Feature adoption curve (% of users who've used feature)

**Weekly Report:**
- Top performing check-in types (most viewed)
- User segments by engagement level
- Retention cohort analysis
- NPS trend over time

---

## Open Questions & Recommendations

### Technical Feasibility Questions

1. **Performance with Large Datasets**
   - **Question:** How will progress history perform for users with 365+ check-ins?
   - **Recommendation:**
     - Implement pagination (20 per page) immediately
     - Add virtualization (react-window) if user feedback indicates slowness
     - Monitor P95 load times; optimize if >1.5s
   - **Decision:** Implement pagination in Phase 1, defer virtualization to Phase 3 if needed

2. **Real-Time Updates for Social Features**
   - **Question:** Should reactions/comments update in real-time or on refresh?
   - **Recommendation:**
     - Use Supabase Realtime for reactions (lightweight, high-value)
     - Defer comments to refresh initially (less frequent, can optimize later)
     - Polling fallback if Realtime connection fails
   - **Decision:** Real-time reactions in Phase 2, polling comments in Phase 2, real-time comments in Phase 3

3. **Offline Support**
   - **Question:** Should check-in detail viewing work offline?
   - **Recommendation:**
     - Cache last 30 check-ins locally (IndexedDB)
     - Show cached data with "Offline" indicator
     - Sync on reconnection
   - **Decision:** Defer to Phase 3 (nice-to-have, not critical)

4. **Image Handling in Check-Ins**
   - **Question:** Should check-in details support progress photos?
   - **Recommendation:**
     - Phase 1: No (text-only notes)
     - Phase 2: Link to existing photo uploads
     - Phase 3: Inline photo display in detail view
   - **Decision:** Scope to Phase 3

---

### Design Decisions Needing User Testing

1. **Modal vs. Bottom Sheet (Mobile Web)**
   - **Test:** A/B test full-screen modal vs. bottom sheet
   - **Hypothesis:** Bottom sheet feels more native, less disruptive
   - **Metrics:** Detail view duration, return rate, user preference survey
   - **Recommendation:** Test with 1,000 users, pick winner based on engagement

2. **Privacy Default (Public vs. Private)**
   - **Test:** 50/50 split between default public vs. default private
   - **Hypothesis:** Default public increases social engagement but may reduce check-in rate for privacy-conscious users
   - **Metrics:** Check-in rate, social views, opt-out rate
   - **Recommendation:** Start with default public, monitor opt-out rate; flip to private if >20% opt out

3. **Filtering: Automatic vs. Manual**
   - **Test:** Show filtered data automatically vs. providing toggle to show all
   - **Hypothesis:** Automatic filtering reduces confusion but may hide useful data
   - **Metrics:** User comprehension (survey), support tickets, feature requests
   - **Recommendation:** Ship automatic in Phase 1, add manual toggle in Phase 2 if requested

4. **Celebration Animation Frequency**
   - **Test:** Celebrate all milestones vs. only major milestones (10 lbs, 30 days, etc.)
   - **Hypothesis:** Too many celebrations feel spammy, too few miss delight opportunities
   - **Metrics:** Animation skips, user delight score, retention
   - **Recommendation:** Test with 500 users, optimize threshold based on feedback

---

### Future Enhancements to Consider

#### Phase 4+ Ideas (Post-Launch)

1. **AI-Powered Insights**
   - Analyze check-in patterns to predict plateaus
   - Recommend optimal check-in times based on personal history
   - Suggest actions based on mood/energy correlation
   - **Effort:** High | **Impact:** Very High | **Priority:** P1 for future

2. **Check-In Streaks Leaderboard**
   - Global and circle-specific streak leaderboards
   - Streak freeze power-ups (1 day grace period)
   - Streak milestones with exclusive badges
   - **Effort:** Medium | **Impact:** High | **Priority:** P1 for Phase 4

3. **Weekly/Monthly Summary Views**
   - Digest view showing week/month at a glance
   - Shareable summary cards (social media)
   - PDF export for personal records
   - **Effort:** Medium | **Impact:** Medium | **Priority:** P2 for Phase 4

4. **Voice Notes for Check-Ins**
   - Record audio notes instead of typing
   - Transcribe to text (optional)
   - Play back in detail view
   - **Effort:** High | **Impact:** Medium | **Priority:** P2 for Phase 5

5. **Integration with Wearables**
   - Auto-import weight from smart scales (Withings, Fitbit Aria)
   - Auto-import steps from Apple Health / Google Fit
   - Reduce manual logging friction
   - **Effort:** Very High | **Impact:** Very High | **Priority:** P0 for Phase 5

6. **Advanced Filtering & Tags**
   - Custom tags for check-ins ("cheat day", "gym day", "sick")
   - Filter by tags
   - Tag-based insights
   - **Effort:** Medium | **Impact:** Medium | **Priority:** P2 for Phase 4

7. **Check-In Templates**
   - Save frequently used notes as templates
   - Quick-fill mood/energy patterns
   - Share templates with circle
   - **Effort:** Low | **Impact:** Low | **Priority:** P3

8. **Compare Mode**
   - Select two check-ins and view side-by-side comparison
   - Highlight differences
   - Useful for "what worked better" analysis
   - **Effort:** Medium | **Impact:** Medium | **Priority:** P2 for Phase 4

---

### Risks and Mitigation Strategies

#### Product Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Users find detail view cluttered** | Medium | High | User testing before build; iterative design; provide "simple view" toggle |
| **Privacy concerns reduce check-in rate** | Low | High | Default public but prominent toggle; educational content on benefits of sharing |
| **Social features feel forced/awkward** | Medium | Medium | Make reactions/comments optional; A/B test visibility; allow disabling social |
| **Too many animations feel gimmicky** | Low | Medium | Respect prefers-reduced-motion; limit celebrations to significant milestones |

#### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Performance degradation with large datasets** | High | High | Implement pagination immediately; monitor P95 latency; optimize queries |
| **Real-time features don't scale** | Low | High | Use Supabase Realtime with fallback to polling; load test before launch |
| **Mobile gestures conflict with browser** | Medium | Medium | Test on all major browsers/devices; provide fallback button navigation |
| **Accessibility violations** | Medium | High | WCAG AA audit before launch; automated testing; keyboard navigation |

#### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Feature doesn't drive retention** | Low | Critical | Ship Phase 1 fast; measure rigorously; pivot if metrics don't hit targets |
| **Social features enable harassment** | Low | High | Moderation tools; report functionality; clear community guidelines |
| **Increased complexity confuses new users** | Medium | Medium | Progressive disclosure; onboarding tooltips; help documentation |
| **Support ticket volume increases** | Medium | Low | Comprehensive FAQs; in-app help; clear error messages |

---

## Appendix: Wireframe Descriptions

### A. Progress History List (Desktop)

```
┌─────────────────────────────────────────────────────────────────┐
│  Progress History                              [Filter ▾]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [Purple gradient bg]                     [Scale icon]     │   │
│  │ 🏋️ Weight Check-In                                        │   │
│  │ 165.3 lbs                    ↓ -1.2 lbs from yesterday    │   │
│  │ Today at 7:45 AM                                          │   │
│  │ 😊 Good     ⚡⚡⚡⚡ High Energy                            │   │
│  │ "Feeling great today!"                              [→]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [Indigo gradient bg]                 [Footprints icon]    │   │
│  │ 👟 Steps Check-In                                         │   │
│  │ 12,847 steps                 128% of goal (10,000)        │   │
│  │ Yesterday at 9:15 PM                                      │   │
│  │ 🎉 Amazing  ⚡⚡⚡⚡⚡ Very High                           │   │
│  │ "New personal record!"                              [→]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [Dual gradient bg: purple→indigo]     [Mixed icon]        │   │
│  │ 📊 Daily Check-In                                         │   │
│  │ 🏋️ 166.5 lbs    👟 10,234 steps                          │   │
│  │ 2 days ago at 8:30 PM                                     │   │
│  │ 😊 Good     ⚡⚡⚡ Moderate                               │   │
│  │                                                      [→]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  [Load More...]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### B. Check-In Detail Modal (Desktop)

```
┌─────────────────────────────────────────────────────────────────┐
│  [X]                                                              │
│  🏋️ Weight Check-In                                              │
│  Saturday, January 18, 2025 • 7:45 AM                            │
│                                                                   │
│  ╔═══════════════════════════════════════════════════════════╗ │
│  ║                     165.3 lbs                              ║ │
│  ║               ↓ -1.2 lbs from yesterday                    ║ │
│  ╚═══════════════════════════════════════════════════════════╝ │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │  😊 Mood         │  │  ⚡ Energy       │                     │
│  │  Good (7/10)     │  │  High (8/10)     │                     │
│  │  ▓▓▓▓▓▓▓░░░      │  │  ▓▓▓▓▓▓▓▓░░      │                     │
│  └──────────────────┘  └──────────────────┘                     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  👟 Steps                                                 │  │
│  │  12,847 steps     [○○○○○○○○ 128%]                        │  │
│  │  Goal: 10,000     +2,847 over goal ✅                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  📝 Notes                                                 │  │
│  │                                                            │  │
│  │  "Had a great workout this morning! Pushed through        │  │
│  │  even though I didn't feel like it at first. Energy       │  │
│  │  is way up today. 🎉"                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  📊 Progress in Summer Transformation                     │  │
│  │                                                            │  │
│  │  Start:    180.0 lbs                                      │  │
│  │  Current:  165.3 lbs    (-14.7 lbs, 73%)                  │  │
│  │  Goal:     160.0 lbs    (5.3 lbs to go)                   │  │
│  │                                                            │  │
│  │  [████████████████████░░░░░░░░] 73%                       │  │
│  │                                                            │  │
│  │  Streak: 🔥 15 days                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  [Edit]   [Make Private]   [Delete]        🌍 Visible to all││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### C. Challenge Type Selection (Creation Flow)

```
┌─────────────────────────────────────────────────────────────────┐
│  Create a FitCircle                                         [X]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  What type of challenge?                                         │
│  This determines what participants will track                    │
│                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │                      │  │                      │              │
│  │       🏋️            │  │       👟            │              │
│  │                      │  │                      │              │
│  │   Weight Loss        │  │   Step Count         │              │
│  │                      │  │                      │              │
│  │  Track weight        │  │  Track daily steps   │              │
│  │  progress daily      │  │  and activity        │              │
│  │                      │  │                      │              │
│  │     [Select]         │  │     [Select]         │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │                      │  │                      │              │
│  │       ⏱️            │  │       ⭐            │              │
│  │                      │  │                      │              │
│  │  Workout Time        │  │  Custom Goal         │              │
│  │                      │  │                      │              │
│  │  Track workout       │  │  Track multiple      │              │
│  │  minutes             │  │  metrics             │              │
│  │                      │  │                      │              │
│  │     [Select]         │  │     [Select]         │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ℹ️ Not sure which to choose?                            │   │
│  │                                                           │   │
│  │  • Weight Loss: Best for challenges focused on losing    │   │
│  │    pounds/kilograms                                       │   │
│  │  • Step Count: Perfect for walking and activity          │   │
│  │    challenges                                             │   │
│  │  • Workout Time: Ideal for building exercise habits      │   │
│  │  • Custom: Track multiple metrics for comprehensive      │   │
│  │    fitness goals                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│                                    [Cancel]  [Continue →]        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Conclusion

This PRD represents a comprehensive enhancement to FitCircle's progress tracking that will:

1. **Increase Engagement**: 8.5 detail views per user per week, 45-second avg session time
2. **Drive Retention**: +7pp D7 retention, +5pp D30 retention
3. **Enable Social**: 15 social views per week, 50% reaction rate
4. **Reduce Confusion**: 95% clarity on challenge types, fewer support tickets
5. **Boost Revenue**: +20% LTV, +4pp premium conversion

By making progress history a destination feature—not just a data log—we transform FitCircle into a platform where users celebrate, connect, and succeed together.

The phased approach ensures we ship value quickly (Phase 1: 2 weeks) while building toward a best-in-class experience that competitors can't match.

**Make it premium. Make it delightful. Make it FitCircle.** 🎉
