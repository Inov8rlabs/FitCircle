'use client';

/**
 * New exercise entry route (kept for deep links; /exercise-log opens the same
 * form in a sheet). Web port of iOS `ExerciseEntryFormView`.
 */
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { WorkoutForm } from '@/components/activity/WorkoutForm';
import { Navbar } from '@/components/layout/navbar';
import { GlassCard, Screen, ScreenHeader } from '@/components/ui/ios';

export default function NewExerciseEntry() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-canvas">
      <Navbar />
      <Screen>
        <Link
          href="/exercise-log"
          className="mb-4 inline-flex items-center gap-1 text-subhead font-semibold text-brand-indigo hover:text-brand-purple"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Activity
        </Link>
        <ScreenHeader title="Log workout" subtitle="Workouts from Apple Health and Health Connect sync on their own." fitzy={false} />
        <GlassCard>
          <WorkoutForm onSaved={() => router.push('/exercise-log')} onCancel={() => router.push('/exercise-log')} />
        </GlassCard>
      </Screen>
    </div>
  );
}
