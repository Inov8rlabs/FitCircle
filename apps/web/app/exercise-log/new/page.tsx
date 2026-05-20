'use client';

/**
 * New exercise entry form — web port of iOS `ExerciseEntryFormView`.
 */

import { ArrowLeft, Dumbbell, Loader2, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { exerciseClient } from '@/lib/api/exercise-client';
import type { ExerciseCategory, LocationType } from '@/lib/types/exercise';

const CATEGORIES: { value: ExerciseCategory; label: string; emoji: string }[] = [
  { value: 'cardio', label: 'Cardio', emoji: '🏃' },
  { value: 'strength', label: 'Strength', emoji: '🏋️' },
  { value: 'flexibility', label: 'Flexibility', emoji: '🧘' },
  { value: 'sports', label: 'Sports', emoji: '⚽' },
  { value: 'outdoor', label: 'Outdoor', emoji: '🥾' },
  { value: 'other', label: 'Other', emoji: '💪' },
];

const LOCATIONS: { value: LocationType; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'gym', label: 'Gym' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'studio', label: 'Studio' },
];

export default function NewExerciseEntry() {
  const router = useRouter();
  const [category, setCategory] = useState<ExerciseCategory>('cardio');
  const [exerciseType, setExerciseType] = useState('');
  const [duration, setDuration] = useState('30');
  const [calories, setCalories] = useState('');
  const [effort, setEffort] = useState('5');
  const [location, setLocation] = useState<LocationType | ''>('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const canSave =
    exerciseType.trim().length >= 2 &&
    Number(duration) > 0 &&
    !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await exerciseClient.create({
        exercise_type: exerciseType.trim(),
        category,
        duration_minutes: Number(duration),
        calories_burned: calories ? Number(calories) : undefined,
        effort_level: effort ? Number(effort) : undefined,
        location_type: location || undefined,
        notes: notes.trim() || undefined,
        source: 'manual',
      });
      toast.success('Workout logged!');
      router.push('/exercise-log');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-xl px-4 py-6">
        <div className="mb-4">
          <Link href="/exercise-log" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </div>

        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <Dumbbell className="h-6 w-6 text-orange-500" />
              <h1 className="text-xl font-bold">Log workout</h1>
            </div>

            {/* Category selector */}
            <div className="space-y-2">
              <Label>Category</Label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`rounded-xl border p-2 text-sm transition-colors ${category === c.value ? 'border-orange-500 bg-orange-500/10' : 'border-border'}`}
                  >
                    <div className="text-xl">{c.emoji}</div>
                    <div className="text-xs mt-1 font-semibold">{c.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="exercise_type">Activity</Label>
              <Input
                id="exercise_type"
                placeholder="e.g. Running, Push-ups, Yoga"
                value={exerciseType}
                onChange={(e) => setExerciseType(e.target.value)}
              />
            </div>

            {/* Duration + Calories */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (min)</Label>
                <Input
                  id="duration"
                  type="number"
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>
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
            </div>

            {/* Effort */}
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

            {/* Location */}
            <div className="space-y-2">
              <Label>Location (optional)</Label>
              <Select value={location} onValueChange={(v) => setLocation(v as LocationType)}>
                <SelectTrigger><SelectValue placeholder="Where?" /></SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map(l => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
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

            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="w-full bg-orange-500 hover:bg-orange-600"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-2" /> Save workout</>}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
