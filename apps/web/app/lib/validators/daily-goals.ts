/**
 * Daily-goal request key aliases.
 *
 * The daily-goals routes validate snake_case bodies (what iOS and current Android
 * send). Released Android builds sent the same fields in camelCase, which zod
 * silently stripped — `goalType` missing meant every create was a 400. The
 * camelCase spellings are accepted as aliases; when a body carries both spellings
 * of a field, snake_case (the original contract) wins.
 */

const CREATE_GOAL_ALIASES: Record<string, string> = {
  challengeId: 'challenge_id',
  goalType: 'goal_type',
  targetValue: 'target_value',
  startDate: 'start_date',
  endDate: 'end_date',
  isPrimary: 'is_primary',
  autoAdjustEnabled: 'auto_adjust_enabled',
};

const UPDATE_GOAL_ALIASES: Record<string, string> = {
  targetValue: 'target_value',
  endDate: 'end_date',
  isActive: 'is_active',
  isPrimary: 'is_primary',
};

function applyAliases(body: unknown, aliases: Record<string, string>): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (out[canonical] === undefined && out[alias] !== undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

export function normalizeCreateGoalBody(body: unknown): unknown {
  return applyAliases(body, CREATE_GOAL_ALIASES);
}

export function normalizeUpdateGoalBody(body: unknown): unknown {
  return applyAliases(body, UPDATE_GOAL_ALIASES);
}
