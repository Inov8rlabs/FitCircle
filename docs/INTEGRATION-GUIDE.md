# Daily Progress Meter - Integration Guide

This guide shows you how to integrate the Daily Progress Meter into the FitCircle dashboard.

## Quick Start

### 1. Run Database Migration

Open Supabase SQL Editor and run:

```bash
/supabase/migrations/026_daily_goals_system.sql
```

This creates the `daily_goals` and `goal_completion_history` tables.

### 2. Update Dashboard Page

Edit `/apps/web/app/dashboard/page.tsx`:

```tsx
// Add import at top
import { DailyProgressMeter } from '@/components/DailyProgressMeter';

// Inside the component, add the meter after Quick Entry section:
export default function DashboardPage() {
  // ... existing code ...

  // Add handler for goal completion
  const handleGoalCompletion = () => {
    // Refresh dashboard stats when goals complete
    fetchDailyStats();
    fetchCheckIns();
  };

  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* ... existing header code ... */}

        {/* Quick Entry Section */}
        <div className="mb-6 sm:mb-8">
          {/* ... existing quick entry cards ... */}
        </div>

        {/* ✅ ADD DAILY PROGRESS METER HERE */}
        <div className="mb-6 sm:mb-8">
          <DailyProgressMeter
            onGoalComplete={handleGoalCompletion}
          />
        </div>

        {/* Engagement Streak Highlight */}
        <div className="mb-6 sm:mb-8">
          <EngagementStreakCard />
        </div>

        {/* ... rest of existing dashboard ... */}
      </div>
    </>
  );
}
```

### 3. Update Check-In Flow to Trigger Goal Updates

Edit the quick-entry submit handlers:

```tsx
// Update handleQuickWeightSubmit
const handleQuickWeightSubmit = async () => {
  if (!user || !quickWeight) return;

  const today = new Date().toISOString().split('T')[0];
  const weightInKg = parseWeightToKg(quickWeight, unitSystem);

  const { error } = await supabase
    .from('daily_tracking')
    .upsert({
      user_id: user.id,
      tracking_date: today,
      weight_kg: weightInKg,
    } as any, {
      onConflict: 'user_id,tracking_date'
    });

  if (error) throw error;

  toast.success('Weight logged!');
  setQuickWeight('');

  // ✅ ADD: Update goal completion
  await updateGoalCompletion(today, { weight_kg: weightInKg });

  fetchCheckIns();
  fetchDailyStats();
};

// Update handleQuickStepsSubmit
const handleQuickStepsSubmit = async () => {
  if (!user || !quickSteps) return;

  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('daily_tracking')
    .upsert({
      user_id: user.id,
      tracking_date: today,
      steps: parseInt(quickSteps),
    } as any, {
      onConflict: 'user_id,tracking_date'
    });

  if (error) throw error;

  toast.success('Steps logged!');
  setQuickSteps('');

  // ✅ ADD: Update goal completion
  await updateGoalCompletion(today, { steps: parseInt(quickSteps) });

  fetchCheckIns();
  fetchDailyStats();
};

// ✅ ADD: Helper function to update goal completion
const updateGoalCompletion = async (date: string, data: {
  weight_kg?: number;
  steps?: number;
}) => {
  try {
    const response = await fetch('/api/daily-goals/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, ...data }),
    });

    if (!response.ok) {
      console.error('Failed to update goal completion');
    }
  } catch (error) {
    console.error('Error updating goal completion:', error);
  }
};
```

### 4. Auto-Create Goals When User Joins Challenge

Edit the challenge join flow (wherever user joins a FitCircle):

```tsx
// In your challenge join handler
const handleJoinChallenge = async (challengeId: string) => {
  // ... existing join logic ...

  // ✅ ADD: Auto-create daily goals
  try {
    const response = await fetch('/api/daily-goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_id: challengeId }),
    });

    if (response.ok) {
      toast.success('Daily goals created! Check your dashboard.');
    }
  } catch (error) {
    console.error('Failed to create daily goals:', error);
  }
};
```

### 5. Install Dependencies

If not already installed:

```bash
cd /Users/ani/Code/FitCircleCode/FitCircleBE
npm install canvas-confetti
```

### 6. Test the Integration

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Test flow:**
   - Login to dashboard
   - Join a FitCircle challenge (or create test goals)
   - Log some steps via quick entry
   - See Daily Progress Meter update in real-time
   - Complete all goals → See confetti celebration!

---

## Alternative Layouts

### Option 1: Side-by-Side with Activity Rings

```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
  {/* Existing Activity Rings */}
  <div>
    <Card className="bg-slate-900/50 border-slate-800">
      <CardContent className="p-6">
        <ActivityRing rings={...} />
      </CardContent>
    </Card>
  </div>

  {/* Daily Progress Meter */}
  <div>
    <DailyProgressMeter onGoalComplete={handleGoalCompletion} />
  </div>
</div>
```

### Option 2: Full-Width Above Stats

```tsx
{/* Daily Progress Meter - Full Width */}
<div className="mb-8">
  <DailyProgressMeter
    onGoalComplete={handleGoalCompletion}
    className="max-w-2xl mx-auto"
  />
</div>

{/* Stats Grid Below */}
<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  {/* ... stat cards ... */}
</div>
```

### Option 3: Replace Existing Activity Ring

```tsx
{/* Replace the current Activity Ring section with Daily Progress Meter */}
<motion.div
  initial={{ opacity: 0, scale: 0.9 }}
  animate={{ opacity: 1, scale: 1 }}
  className="lg:col-span-1"
>
  <DailyProgressMeter onGoalComplete={handleGoalCompletion} />
</motion.div>
```

---

## Customization Options

### Change Ring Size

```tsx
<DailyProgressMeter
  ringSize={240} // Default is 200
  strokeWidth={16} // Default is 14
/>
```

### Disable Auto-Refresh

```tsx
// In DailyProgressMeter.tsx, remove or comment out:
// const interval = setInterval(fetchProgress, 30000);
```

### Custom Celebration

```tsx
<DailyProgressMeter
  onGoalComplete={() => {
    // Custom celebration logic
    console.log('All goals complete!');
    // Trigger your own confetti/sound/modal
  }}
/>
```

---

## Troubleshooting

### "Component not showing"
- Check that migration ran successfully
- Check browser console for errors
- Verify API endpoint `/api/daily-goals/progress` returns data

### "Goals not auto-creating"
- Check that challenge join triggers POST to `/api/daily-goals`
- Verify user is authenticated
- Check Supabase logs for errors

### "Progress not updating after check-in"
- Ensure `updateGoalCompletion()` is called after upsert
- Check `goal_completion_history` table for recent entries
- Component has 30s refresh - may take up to 30s to update

### "Confetti not working"
- Verify `canvas-confetti` is installed
- Check browser console for errors
- Confetti only triggers once per session (uses `hasShownCelebration` flag)

---

## Performance Tips

1. **Debounce quick-entry updates:**
   ```tsx
   // Only update goals after successful DB write
   if (!error) {
     await updateGoalCompletion(...);
   }
   ```

2. **Cache API responses:**
   ```tsx
   // Consider using SWR or React Query for caching
   import useSWR from 'swr';

   const { data, error } = useSWR('/api/daily-goals/progress', fetcher, {
     refreshInterval: 30000 // 30s
   });
   ```

3. **Lazy load confetti:**
   ```tsx
   // Only import confetti when needed
   const loadConfetti = async () => {
     const confetti = await import('canvas-confetti');
     confetti.default({...});
   };
   ```

---

## Next Steps

After integration:

1. **Analytics:** Track events (see spec section 5.4)
2. **A/B Test:** Test different layouts
3. **Monitor:** Watch for errors in Sentry/logs
4. **Iterate:** Gather user feedback and adjust

---

**Questions?** See `/DAILY-PROGRESS-METER-IMPLEMENTATION.md` for detailed documentation.
