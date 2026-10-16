import { z } from 'zod';

/** Shared request schemas for the mobile + web invite/nudge routes (docs/REFERRALS_SPEC.md §9.2). */
export const inviteContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        email: z.string().max(254).optional(),
        phone: z.string().max(32).optional(),
        name: z.string().max(60).optional(),
        channel: z.enum(['email', 'sms']).optional(),
      })
    )
    .min(1)
    .max(10),
  circleId: z.string().uuid().optional(),
});

export const nudgeSchema = z
  .object({ inviteId: z.string().uuid().optional(), referralId: z.string().uuid().optional() })
  .refine((b) => !!b.inviteId !== !!b.referralId, { message: 'Send exactly one of inviteId or referralId' });
