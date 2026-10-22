import { type NextResponse } from 'next/server';

import { CampaignError } from '@/lib/campaigns/http';
import { fail, failFrom } from '@/lib/referrals/http';

export { ok, fail } from '@/lib/referrals/http';

/** Typed error a home-feed route maps straight to the standard error envelope. */
export class HomeFeedError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly data: unknown = null
  ) {
    super(message);
    this.name = 'HomeFeedError';
  }
}

/** Map anything a home-feed route can throw (incl. the shared admin gate's CampaignError) to the envelope. */
export function feedFailFrom(error: unknown, label: string): NextResponse {
  if (error instanceof HomeFeedError || error instanceof CampaignError) return fail(error.status, error.code, error.message, error.data);
  if ((error as any)?.name === 'ZodError') {
    const issues = ((error as any).issues ?? []).map((i: any) => ({ path: (i.path ?? []).join('.'), message: i.message }));
    return fail(400, 'VALIDATION_ERROR', 'Invalid request body', { issues });
  }
  return failFrom(error, `home-feed/${label}`);
}

/** Read a JSON body; empty/invalid JSON → undefined (zod then reports it). */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
