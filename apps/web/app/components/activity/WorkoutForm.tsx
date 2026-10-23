'use client';

/**
 * Manual workout entry — web port of iOS `ExerciseEntryFormView`. Used by the
 * add-workout sheet on /exercise-log and by the /exercise-log/new route.
 * Same POST /api/mobile/exercises payload and Workout Logged event as before.
 */
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AnalyticsEvents, analytics, durationBand } from '@/lib/analytics';
import { exerciseClient } from '@/lib/api/exercise-client';
import { announceStreakAutoClaim } from '@/lib/streaks/auto-claim-events';
import type { ExerciseCategory, ExerciseLog, LocationType } from '@/lib/types/exercise';
import { cn } from '@/lib/utils';

import { CATEGORY_TONE, workoutIcon } from './workout-meta';

const CATEGORIES: { value: ExerciseCategory; label: string; example: string }[] = [
  { value: 'cardio', label: 'Cardio', example: 'Running' },
  { value: 'strength', label: 'Strength', example: 'Strength training' },
  { value: 'flexibility', label: 'Flexibility', example: 'Yoga' },
  { value: 'sports', label: 'Sports', example: 'Tennis' },
  { value: 'outdoor', label: 'Outdoor', example: 'Hiking' },
  { value: 'other', label: 'Other', example: 'Workout' },
];

const LOCATIONS: { value: LocationType; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'gym', label: 'Gym' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'studio', label: 'Studio' },
];

const DURATION_PRESETS = [15, 30, 45, 60];

const TONE_RING: Record<string, string> = {
  orange: 'border-brand-orange/60 bg-brand-orange/10 text-brand-orange',
  purple: 'border-brand-purple/60 bg-brand-purple/10 text-brand-purple',
  cyan: 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan',
  yellow: 'border-brand-yellow/60 bg-brand-yellow/10 text-brand-yellow',
  green: 'border-brand-green/60 bg-brand-green/10 text-brand-green',
  indigo: 'border-brand-indigo/60 bg-brand-indigo/10 text-brand-indigo',
};

export function WorkoutForm({
  onSaved,
  onCancel,
}: {
  onSaved: (exercise: ExerciseLog | null) => void;
  onCancel?: () => void;
}) {
  const [category, setCategory] = useState<ExerciseCategory>('cardio');
  const [exerciseType, setExerciseType] = useState('');
  const [duration, setDuration] = useState('30');
  const [calories, setCalories] = useState('');
  const [effort, setEffort] = useState('5');
  const [location, setLocation] = useState<LocationType | ''>('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const canSave = exerciseType.trim().length >= 2 && Number(duration) > 0 && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const { exercise, streak } = await exerciseClient.create({
        exercise_type: exerciseType.trim(),
        category,
        duration_minutes: Number(duration),
        calories_burned: calories ? Number(calories) : undefined,
        effort_level: effort ? Number(effort) : undefined,
        location_type: location || undefined,
        notes: notes.trim() || undefined,
        source: 'manual',
      });
      analytics.track(
        AnalyticsEvents.workoutLogged({
          source: 'form',
          category,
          duration_band: durationBand(Number(duration)),
          is_edit: false,
        })
      );
      toast.success('Workout logged!');
      // Server-side streak auto-claim for this workout → refresh streak UI + toast.
      announceStreakAutoClaim(streak);
      onSaved(exercise ?? null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      className="space-y-5"
      data-testid="workout-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <fieldset>
        <legend className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">Category</legend>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map((c) => {
            const Icon = workoutIcon(c.example, c.value);
            const selected = category === c.value;
            return (
              <button
                key={c.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(c.value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-subhead font-semibold transition duration-200 ease-ios',
                  selected ? TONE_RING[CATEGORY_TONE[c.value]] : 'border-hairline bg-white/5 text-fg-secondary hover:bg-white/10'
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {c.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="exercise_type">Activity</Label>
        <Input
          id="exercise_type"
          placeholder="e.g. Running, Push-ups, Yoga"
          value={exerciseType}
          onChange={(e) => setExerciseType(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="duration">Duration (min)</Label>
        <div className="flex gap-2">
          <div className="w-24 shrink-0">
            <Input
              id="duration"
              type="number"
              inputMode="numeric"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div className="flex flex-1 gap-1.5">
            {DURATION_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDuration(String(m))}
                className={cn(
                  'h-11 flex-1 rounded-lg border text-subhead font-semibold transition',
                  Number(duration) === m
                    ? 'border-brand-purple/60 bg-brand-purple/15 text-white'
                    : 'border-hairline bg-white/5 text-fg-secondary hover:bg-white/10'
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="calories">Calories (optional)</Label>
          <Input
            id="calories"
            type="number"
            inputMode="numeric"
            placeholder="kcal"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="effort">Effort (RPE 1–10)</Label>
          <Input
            id="effort"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
          />
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">Location (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {LOCATIONS.map((l) => (
            <button
              key={l.value}
              type="button"
              aria-pressed={location === l.value}
              onClick={() => setLocation(location === l.value ? '' : l.value)}
              className={cn(
                'h-9 rounded-full px-4 text-subhead font-medium transition',
                location === l.value ? 'bg-brand-indigo text-white' : 'bg-surface-raised/80 text-fg-secondary hover:text-white'
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="How did it feel? PR? Any soreness?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!canSave} size="lg" className="sm:min-w-40" data-testid="workout-save">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save workout'}
        </Button>
      </div>
    </form>
  );
}
