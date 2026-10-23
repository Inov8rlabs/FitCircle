import {
  Activity,
  Bike,
  Dumbbell,
  Footprints,
  HeartPulse,
  Mountain,
  PersonStanding,
  Trophy,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import type { Tone } from '@/components/ui/ios';
import type { ExerciseCategory } from '@/lib/types/exercise';

/** Filter chips, in the iOS Exercise Log order. */
export const CATEGORY_FILTERS: { id: 'all' | ExerciseCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cardio', label: 'Cardio & Endurance' },
  { id: 'strength', label: 'Strength & Conditioning' },
  { id: 'flexibility', label: 'Flexibility & Mobility' },
  { id: 'sports', label: 'Sports' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'other', label: 'Other' },
];

export const CATEGORY_TONE: Record<ExerciseCategory, Tone> = {
  cardio: 'orange',
  strength: 'purple',
  flexibility: 'cyan',
  sports: 'yellow',
  outdoor: 'green',
  other: 'indigo',
};

/** Icon for a workout, from its type name first (Walking → footprints), then its category. */
export function workoutIcon(type: string, category: ExerciseCategory): LucideIcon {
  const t = type.toLowerCase();
  if (/walk|hike/.test(t)) return /hike/.test(t) ? Mountain : Footprints;
  if (/run|jog/.test(t)) return PersonStanding;
  if (/cycl|bike|spin/.test(t)) return Bike;
  if (/swim|row/.test(t)) return Waves;
  if (/yoga|stretch|pilates|mobility/.test(t)) return HeartPulse;
  if (/strength|weight|lift|push|squat|hiit/.test(t)) return Dumbbell;
  switch (category) {
    case 'strength':
      return Dumbbell;
    case 'flexibility':
      return HeartPulse;
    case 'sports':
      return Trophy;
    case 'outdoor':
      return Mountain;
    case 'cardio':
      return Activity;
    default:
      return Activity;
  }
}

export function formatDistance(meters: number | null | undefined, imperial = false): string | null {
  if (!meters || meters <= 0) return null;
  if (imperial) return `${(meters / 1609.344).toFixed(1)} mi`;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatSteps(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
