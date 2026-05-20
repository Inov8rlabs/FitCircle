import { useAuthStore } from '@/stores/auth-store';

export type ExerciseFrequency = 'never' | '1-2x_week' | '3-4x_week' | 'daily';
export type PrimaryGoal = 'lose_weight' | 'gain_muscle' | 'improve_cardio' | 'maintain_health' | 'stress_relief';
export type PreferredWorkout =
  | 'cardio' | 'strength' | 'yoga' | 'sports' | 'dancing' | 'outdoor' | 'home_workouts';
export type DailyTime = '15min' | '30min' | '45min' | '60min' | '90min+';
export type FitnessSelfAssessment = 'complete_beginner' | 'some_experience' | 'regular_exerciser' | 'very_fit';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface AssessmentResponses {
  exercise_frequency: ExerciseFrequency;
  primary_goal: PrimaryGoal;
  preferred_workouts: PreferredWorkout[];
  daily_time: DailyTime;
  fitness_self_assessment: FitnessSelfAssessment;
}

export interface CircleRecommendation {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  matchReason: string;
  matchScore: number;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
  }
  return json as T;
}

export const onboardingClient = {
  submitAssessment: (responses: AssessmentResponses) =>
    authedFetch<{ success: boolean; data: { fitnessLevel: FitnessLevel } }>(
      '/api/mobile/onboarding/assessment',
      { method: 'POST', body: JSON.stringify(responses) }
    ),

  getRecommendations: () =>
    authedFetch<{ success: boolean; data: { recommendations: CircleRecommendation[] } }>(
      '/api/mobile/onboarding/recommendations'
    ),

  complete: () =>
    authedFetch<{ success: boolean }>('/api/mobile/onboarding/complete', {
      method: 'POST',
    }),

  joinRecommendedCircle: (circleId: string) =>
    authedFetch<{ success: boolean }>(`/api/mobile/circles/${circleId}/join`, {
      method: 'POST',
    }),
};
