import { type NextResponse } from 'next/server';

import { fail, failFrom } from '@/lib/referrals/http';

export { ok, fail } from '@/lib/referrals/http';

/** Typed error a campaign route maps straight to the envelope. */
export class CampaignError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly data: unknown = null
  ) {
    super(message);
    this.name = 'CampaignError';
  }
}

export const notFound = (what = 'Campaign') => new CampaignError(404, 'NOT_FOUND', `${what} not found`);

/** Map anything a campaign route can throw to the standard envelope. */
export function campaignFailFrom(error: unknown, label: string): NextResponse {
  if (error instanceof CampaignError) return fail(error.status, error.code, error.message, error.data);
  if ((error as any)?.name === 'ZodError') {
    const issues = ((error as any).issues ?? []).map((i: any) => ({ path: (i.path ?? []).join('.'), message: i.message }));
    return fail(400, 'VALIDATION_ERROR', 'Invalid request body', { issues });
  }
  return failFrom(error, `campaigns/${label}`);
}

/** Read a JSON body; empty/invalid JSON → {} (zod then reports what's missing). */
export async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
