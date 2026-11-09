/** Request bodies for /api/admin/trial-sync/{plan,apply} (docs/TRIAL_SYNC.md §4). Store support is checked by the service. */
import { z } from 'zod';

const days = z.number({ invalid_type_error: 'Expected a number of days' }).int('Expected whole days').min(1).max(366);

export const trialPlanSchema = z.object({ days }).strict();
export const trialApplySchema = z
  .object({
    days,
    planHash: z.string().regex(/^[0-9a-f]{64}$/, 'Expected the planHash returned by POST /api/admin/trial-sync/plan'),
  })
  .strict();
