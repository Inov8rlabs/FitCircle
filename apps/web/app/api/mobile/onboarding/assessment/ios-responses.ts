/**
 * The iOS app sends its answers as
 *   { responses: [{ question_key, selected_values: [...] }] }
 * with its own question keys/values (Core/Models/Onboarding.swift
 * defaultQuestions). Map them onto the flat schema above. Before this every
 * iOS submission was a 400 and no iOS assessment was ever saved.
 */
const IOS_VALUE_MAP: Record<string, { field: string; values: Record<string, string> }> = {
  frequency: {
    field: 'exercise_frequency',
    values: { rarely: 'never', '1_2_week': '1-2x_week', '3_4_week': '3-4x_week', '5_plus_week': 'daily' },
  },
  goals: {
    field: 'primary_goal',
    values: {
      lose_weight: 'lose_weight',
      build_muscle: 'gain_muscle',
      stay_active: 'maintain_health',
      reduce_stress: 'stress_relief',
      improve_endurance: 'improve_cardio',
    },
  },
  activity_types: {
    field: 'preferred_workouts',
    values: {
      running: 'cardio',
      weight_training: 'strength',
      yoga: 'yoga',
      cycling: 'cardio',
      swimming: 'cardio',
      walking: 'outdoor',
      team_sports: 'sports',
    },
  },
  time_available: {
    field: 'daily_time',
    values: { '15_min': '15min', '30_min': '30min', '45_min': '45min', '60_plus': '60min' },
  },
  fitness_level: {
    field: 'fitness_self_assessment',
    values: {
      beginner: 'complete_beginner',
      intermediate: 'some_experience',
      advanced: 'regular_exerciser',
      expert: 'very_fit',
    },
  },
};

/** The iOS `responses` array as the flat body; any other body is returned unchanged. */
export function fromIosResponses(body: unknown): unknown {
  const responses = (body as { responses?: unknown } | null)?.responses;
  if (!Array.isArray(responses)) return body;

  const flat: Record<string, unknown> = {};
  for (const response of responses) {
    const key = response?.question_key;
    const mapping = typeof key === 'string' ? IOS_VALUE_MAP[key] : undefined;
    if (!mapping || !Array.isArray(response.selected_values)) continue;
    const values = response.selected_values
      .map((value: unknown) => (typeof value === 'string' ? (mapping.values[value] ?? value) : value))
      .filter((value: unknown, index: number, all: unknown[]) => all.indexOf(value) === index);
    // preferred_workouts is the only multi-select field; the others take the first answer.
    flat[mapping.field] = mapping.field === 'preferred_workouts' ? values : values[0];
  }
  return flat;
}
