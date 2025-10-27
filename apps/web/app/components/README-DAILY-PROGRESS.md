# Daily Progress Meter - Dashboard Integration Guide

This guide explains how to integrate the Daily Progress Meter feature into your dashboard.

## Overview

The Daily Progress Meter provides:
- Real-time progress tracking for daily fitness goals
- Streak visualization and motivation
- Circular progress rings inspired by Apple Watch
- Celebration animations on goal completion
- Goal management (create, update, delete)

## Files Structure

```
apps/web/app/
├── lib/
│   └── services/
│       └── daily-goals.ts              # Business logic service
├── api/
│   └── daily-goals/
│       ├── route.ts                    # GET/POST goals
│       ├── progress/route.ts           # GET today's progress
│       ├── history/route.ts            # GET completion history
│       └── [id]/route.ts               # PATCH/DELETE specific goal
├── hooks/
│   └── useDailyGoals.ts                # React hooks for easy integration
└── components/
    ├── DailyProgressMeter.tsx          # Main progress meter component
    └── README-DAILY-PROGRESS.md        # This file
```

## Quick Start

### 1. Install Dependencies

The required dependencies should already be installed:
- `canvas-confetti` - For celebration animations
- `@radix-ui/react-progress` - Progress bars
- `recharts` - Charts (if showing history)

### 2. Import the Hook

```tsx
import { useDailyGoals } from '@/hooks/useDailyGoals';
```

### 3. Use in Your Dashboard

```tsx
'use client';

import { useDailyGoals } from '@/hooks/useDailyGoals';
import { DailyProgressMeter } from '@/components/DailyProgressMeter';

export function Dashboard() {
  const { goals, progress, streak, isLoading, error, refresh } = useDailyGoals();

  if (isLoading) {
    return <div>Loading goals...</div>;
  }

  if (error) {
    return <div>Error loading goals: {error.message}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Progress Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400">Today's Progress</p>
          <p className="text-2xl font-bold text-white">
            {progress?.overall_completion.toFixed(0)}%
          </p>
        </div>

        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400">Goals Completed</p>
          <p className="text-2xl font-bold text-white">
            {progress?.completed_goals} / {progress?.total_goals}
          </p>
        </div>

        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400">Current Streak</p>
          <p className="text-2xl font-bold text-orange-500">
            🔥 {streak.current_streak} days
          </p>
        </div>
      </div>

      {/* Daily Progress Meter Component */}
      <DailyProgressMeter
        goals={progress?.goals || []}
        overallProgress={progress?.overall_completion || 0}
        streak={streak}
        onRefresh={refresh}
      />

      {/* Individual Goal Cards */}
      <div className="grid grid-cols-2 gap-4">
        {progress?.goals.map(goal => (
          <GoalCard key={goal.goal_id} goal={goal} />
        ))}
      </div>
    </div>
  );
}
```

## Hook API Reference

### `useDailyGoals()`

Main hook for accessing daily goals and progress.

**Returns:**
```typescript
{
  goals: DailyGoal[];                    // User's active goals
  progress: DailyProgress | null;        // Today's progress
  streak: StreakInfo;                     // Streak information
  isLoading: boolean;                     // Loading state
  isError: boolean;                       // Error state
  error: Error | undefined;               // Error object
  refresh: () => Promise<void>;          // Manually refresh data
}
```

**Example:**
```tsx
const { goals, progress, streak, isLoading } = useDailyGoals();
```

### `useDailyGoalsHistory(limit?: number)`

Hook for fetching historical completion data.

**Parameters:**
- `limit` (optional): Number of days to fetch (default: 30)

**Returns:**
```typescript
{
  history: GoalCompletion[];             // Historical completions
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  refresh: () => Promise<void>;
}
```

**Example:**
```tsx
const { history, isLoading } = useDailyGoalsHistory(7); // Last 7 days
```

### `useDailyGoal(goalId: string)`

Hook for managing individual goals.

**Returns:**
```typescript
{
  updateGoal: (updates: {
    target_value?: number;
    is_primary?: boolean;
  }) => Promise<any>;
  deleteGoal: () => Promise<any>;
  setPrimary: () => Promise<any>;
  isUpdating: boolean;
}
```

**Example:**
```tsx
const { updateGoal, deleteGoal, setPrimary, isUpdating } = useDailyGoal(goalId);

// Adjust goal target
await updateGoal({ target_value: 10000 });

// Set as primary goal
await setPrimary();

// Delete goal
await deleteGoal();
```

## Component Props

### DailyProgressMeter

**Props:**
```typescript
interface DailyProgressMeterProps {
  goals: GoalProgress[];                 // Today's goal progress
  overallProgress: number;               // 0-100 percentage
  streak: StreakInfo;                    // Streak data
  onRefresh?: () => void;                // Refresh callback
  showHistory?: boolean;                 // Show completion history
  compact?: boolean;                     // Compact mode
}
```

## API Endpoints

The following API endpoints are available:

### GET `/api/daily-goals`
Fetch user's active daily goals.

**Response:**
```json
{
  "goals": [
    {
      "id": "uuid",
      "goal_type": "steps",
      "target_value": 10000,
      "unit": "steps",
      "is_primary": true,
      "start_date": "2025-01-01",
      "end_date": "2025-12-31"
    }
  ]
}
```

### GET `/api/daily-goals/progress`
Get today's progress and streak information.

**Response:**
```json
{
  "progress": {
    "date": "2025-01-15",
    "goals": [
      {
        "goal_id": "uuid",
        "goal_type": "steps",
        "target_value": 10000,
        "actual_value": 7500,
        "completion_percentage": 75,
        "is_completed": false
      }
    ],
    "overall_completion": 75,
    "total_goals": 2,
    "completed_goals": 1
  },
  "streak": {
    "current_streak": 5,
    "longest_streak": 12,
    "last_completion_date": "2025-01-14"
  }
}
```

### GET `/api/daily-goals/history?limit=30`
Get completion history.

**Query Parameters:**
- `limit` (optional): Number of records (default: 30)

**Response:**
```json
{
  "history": [
    {
      "id": "uuid",
      "completion_date": "2025-01-14",
      "target_value": 10000,
      "actual_value": 12500,
      "completion_percentage": 100,
      "is_completed": true
    }
  ]
}
```

### POST `/api/daily-goals`
Create daily goals from a challenge or manually.

**Request Body:**
```json
{
  "challenge_id": "uuid"  // Optional: Create from challenge
}
```

OR

```json
{
  "goals": [
    {
      "goal_type": "steps",
      "target_value": 10000,
      "unit": "steps",
      "frequency": "daily"
    }
  ]
}
```

### PATCH `/api/daily-goals/[id]`
Update a specific goal.

**Request Body:**
```json
{
  "target_value": 12000,      // Optional
  "is_primary": true          // Optional
}
```

### DELETE `/api/daily-goals/[id]`
Soft delete a goal (sets `is_active` to false).

**Response:**
```json
{
  "success": true
}
```

## Integration with Daily Tracking

Daily goals are automatically updated when users log their daily tracking data:

```typescript
// This happens automatically in /api/mobile/tracking/daily
// When user logs steps/weight/mood/energy, goal completion is calculated
```

## Integration with Challenges

Daily goals are automatically created when users join a challenge:

```typescript
// This happens automatically in /api/mobile/circles/join
// Goals are created based on challenge type (weight_loss, step_count, etc.)
```

## Styling Guidelines

The component uses the app's design system:

**Colors:**
- Steps: Indigo (#6366f1)
- Weight: Purple (#8b5cf6)
- Streaks: Orange (#f97316)
- Success: Green (#10b981)

**Layout:**
- Circular progress meters (Apple Watch-inspired)
- Dark theme with bright accents
- Glass-morphism cards with backdrop blur

## Example: Complete Dashboard Integration

```tsx
'use client';

import { useDailyGoals, useDailyGoalsHistory } from '@/hooks/useDailyGoals';
import { DailyProgressMeter } from '@/components/DailyProgressMeter';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function FitnessDashboard() {
  const { goals, progress, streak, isLoading, error, refresh } = useDailyGoals();
  const { history } = useDailyGoalsHistory(7);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500 rounded-lg">
        <p className="text-red-500">Failed to load goals: {error.message}</p>
        <button onClick={refresh} className="mt-2 text-sm underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Your Fitness Dashboard</h1>

      {/* Progress Overview */}
      <DailyProgressMeter
        goals={progress?.goals || []}
        overallProgress={progress?.overall_completion || 0}
        streak={streak}
        onRefresh={refresh}
        showHistory
      />

      {/* Weekly Progress Chart */}
      <div className="p-6 bg-slate-800 rounded-lg">
        <h2 className="text-xl font-bold text-white mb-4">Weekly Progress</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history}>
            <XAxis dataKey="completion_date" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #475569',
                borderRadius: '8px',
              }}
            />
            <Line
              type="monotone"
              dataKey="completion_percentage"
              stroke="#8b5cf6"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Individual Goals */}
      <div className="grid gap-4">
        <h2 className="text-xl font-bold text-white">Today's Goals</h2>
        {progress?.goals.map(goal => (
          <GoalCard key={goal.goal_id} goal={goal} />
        ))}
      </div>
    </div>
  );
}
```

## Testing

The implementation includes comprehensive test coverage:

```bash
# Run tests
npm test -- daily-goals

# Run specific test file
npm test -- __tests__/unit/services/daily-goals.test.ts
```

## Troubleshooting

### Goals not appearing?
- Check if user has joined a challenge
- Verify daily_goals table has records
- Check browser console for API errors

### Progress not updating?
- Ensure daily tracking data is being logged
- Check if goal completion is being calculated
- Verify date formats are correct (YYYY-MM-DD)

### Celebration not triggering?
- Check if canvas-confetti is installed
- Verify goal completion percentage reaches 100
- Check browser console for errors

## Next Steps

1. **Add goal recommendations** - Suggest goals based on user history
2. **Add goal templates** - Pre-defined goal templates
3. **Add social features** - Share goals with friends
4. **Add push notifications** - Remind users to complete goals
5. **Add achievements** - Unlock achievements for streaks

## Support

For issues or questions:
- Check the implementation spec: `/docs/DAILY-PROGRESS-METER-SPEC.md`
- Check the implementation summary: `/DAILY-PROGRESS-METER-IMPLEMENTATION.md`
- Review API route files for detailed implementation
