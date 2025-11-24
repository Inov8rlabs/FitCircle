# FitCircle Daily Streak System Documentation

## Overview

FitCircle's daily streak system is designed to encourage consistent user engagement through a comprehensive gamification mechanism that tracks consecutive daily activities and provides recovery options for missed days.

## Core Concepts

### What is a Streak?
A streak represents consecutive days where a user has performed at least one qualifying activity. The streak continues as long as the user maintains daily engagement.

### Current Streak vs. Longest Streak
- **Current Streak**: Number of consecutive days with activity (resets when broken)
- **Longest Streak**: Personal best streak achievement (never resets)

## Streak Triggers & Activities

### Primary Triggers (Automatic)
1. **Manual Data Entry** - Auto-claims streak when logging:
   - Weight measurements
   - Food entries (meals, snacks, water)
   - Beverage consumption
   - Mood/Energy ratings

2. **Explicit Streak Claim** - Manual "Claim Streak" button press

3. **Circle Participation** - FitCircle check-ins and interactions

### Activity Types That Count
```typescript
type ActivityType =
  | 'weight_log'        // Manual weight entry
  | 'steps_log'         // Step data synchronization
  | 'mood_log'          // Mood/energy logging
  | 'circle_checkin'    // FitCircle participation
  | 'social_interaction' // Social features usage
  | 'streak_freeze'     // Manual freeze application
```

## Streak Calculation Logic

### Daily Check Algorithm
The system counts backwards from today through the last 90 days:

```javascript
// Pseudo-code for streak calculation
for (let i = 0; i < 90; i++) {
  const checkDate = new Date(today);
  checkDate.setDate(checkDate.getDate() - i);

  if (hasActivityOnDate(checkDate)) {
    currentStreak++;
  } else if (i === 0) {
    // Today doesn't break streak (grace period)
    continue;
  } else {
    // Missed day - check freeze availability
    if (freezesAvailable > 0) {
      autoApplyFreeze();
      continue;
    } else {
      streakBroken = true;
      break;
    }
  }
}
```

### Key Rules
- **Consecutive Days**: ≥1 activity per day required
- **Grace Period**: Today (day 0) doesn't count against streak
- **No Retroactive Credit**: Past days can't be claimed automatically
- **7-Day Window**: Manual retroactive claiming allowed up to 7 days back

## Freeze System (Auto-Save Mechanism)

### Freeze Mechanics
- **Starting Freezes**: 1 freeze upon account creation
- **Earning Freezes**: 1 freeze earned every 7 consecutive days
- **Maximum Freezes**: 5 freezes total (hard cap)
- **Weekly Reset**: 1 free freeze added every 7 days (automatic)

### Freeze Application
```javascript
// When a day is missed:
if (freezesAvailable > 0) {
  freezesAvailable--;  // Consume 1 freeze
  streakContinues = true;
  // User notified of auto-freeze application
} else {
  currentStreak = 0;  // Streak broken
  // Recovery options presented
}
```

### Freeze Reset Logic
```javascript
// Weekly reset check (runs daily)
const resetDue = today >= nextResetDate;
if (resetDue) {
  freezesAvailable = Math.min(MAX_FREEZES, freezesAvailable + 1);
  nextResetDate = today + 7 days;
}
```

## Health Data Requirements

### Qualification Criteria
To claim/maintain a streak, users must have **at least one** of the following:

- ✅ **Weight Data**: Manual entry or device sync
- ✅ **Steps Data**: From connected health apps/devices
- ✅ **Mood/Energy Ratings**: Manual mood logging
- ✅ **Manual Activity**: Food/beverage logging

### Claim Validation
```javascript
async function canClaimStreak(userId, date, timezone) {
  // 1. Check date validity (not future, within 7-day window)
  // 2. Check if already claimed
  // 3. Verify health data availability
  // 4. Apply grace period rules for yesterday

  return {
    canClaim: boolean,
    alreadyClaimed: boolean,
    hasHealthData: boolean,
    gracePeriodActive: boolean?
  };
}
```

## System Architecture

### Data Flow
```
User Action → Activity Recorded → Streak Updated
    ↓              ↓                ↓
Data Entry → 'activity_type' → current_streak++
Streak Claim → 'weight_log' → current_streak++
Circle Check-in → 'circle_checkin' → current_streak++
```

### Database Tables
- **`engagement_streaks`**: User streak records
- **`engagement_activities`**: Daily activity log
- **`streak_claims`**: Explicit claim history
- **`streak_freezes`**: Freeze inventory and usage

### Service Layer
- **EngagementStreakService**: Core streak management
- **StreakClaimingService**: Claim validation and processing
- **Recovery System**: Shield and recovery mechanics

## Recovery & Shield System

### Recovery Options
1. **Weekend Warrior Pass**: Covers weekend gaps
2. **Milestone Shields**: Earned at streak milestones (30, 60, 90 days)
3. **Purchased Resurrection**: Premium recovery option

### Shield Earnings
```javascript
// Milestone-based shield granting
const MILESTONES = [30, 60, 90, 120, 150, 180];
function getMilestoneInfo(streakDays) {
  const milestone = MILESTONES.find(m => m === streakDays);
  if (milestone) {
    return {
      milestone,
      shieldsGranted: Math.floor(milestone / 30), // 1 shield per 30 days
      type: 'shield_earned'
    };
  }
  return null;
}
```

## Streak Breaking Scenarios

### Automatic Breaking
- **No Activity + No Freezes**: Streak resets to 0
- **Manual Freeze Application**: Preserves streak continuity
- **Streak Pause**: Up to 90 days for life events (vacation, illness)

### Recovery Flow
```javascript
// When streak is broken:
1. Check available recovery options
2. Present recovery UI with shield costs
3. Apply selected recovery
4. Restore streak continuity
5. Update freeze/shield inventory
```

## API Endpoints

### Core Endpoints
- `POST /api/streaks/claim` - Claim streak for date
- `GET /api/streaks/claim-status` - Check claim status
- `GET /api/streaks/claimable-days` - Get retroactive options
- `POST /api/streaks/freeze/activate` - Apply freeze
- `GET /api/streaks/shields` - Check shield inventory

### Mobile Integration
- **Automatic Claiming**: Triggered by data entry
- **Manual Claiming**: User-initiated via UI
- **Background Sync**: Offline claim queuing
- **Error Handling**: Retry logic for failed claims

## User Experience

### Streak Maintenance
**Easy Path**: Just use the app daily - automatic claiming handles the rest.

**Proactive Path**: Manual claiming for missed days (within 7-day window).

### Notifications & Feedback
- **Auto-claim Success**: Toast notification with new streak count
- **Freeze Application**: Notification when auto-applied
- **Milestone Achievement**: Special celebration for streak records
- **Recovery Options**: Gentle prompts when streak is at risk

## Technical Implementation

### Cron Jobs
- **Daily Check**: Midnight UTC - processes broken streaks
- **Weekly Reset**: Sunday midnight - freeze replenishment
- **Streak Validation**: Continuous validation of streak integrity

### Error Handling
- **Network Failures**: Queue claims for retry
- **Invalid Claims**: Clear error messaging
- **Data Inconsistencies**: Automatic reconciliation
- **Race Conditions**: Optimistic locking for concurrent updates

## Business Logic Summary

### Streak Continuation Triggers:
1. **Any Manual Data Entry** (weight, food, beverages, mood)
2. **Explicit Streak Claims** (button press)
3. **Circle Participation** (check-ins, interactions)

### Streak Breaking Prevention:
1. **Automatic Freezes** (earned every 7 days, max 5)
2. **Manual Freeze Application** (user-controlled)
3. **Recovery Options** (shields, passes, resurrection)

### Health Data Validation:
- **Required**: At least one health metric per day
- **Sources**: Manual entry, device sync, app interactions
- **Retroactive Window**: 7 days for manual claims

This system creates a compelling daily engagement loop while providing generous recovery options to prevent user frustration from temporary lapses.
