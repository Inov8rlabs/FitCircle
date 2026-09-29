import { z } from 'zod';

/**
 * The JSON body of a request, or `{}` when the request has no body at all (a
 * client whose request fields are all optional may send nothing).
 *
 * A body that is present but is not JSON throws a `ZodError`, so the route's
 * existing validation branch answers 400 VALIDATION_ERROR instead of a 500.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new z.ZodError([
      { code: z.ZodIssueCode.custom, path: [], message: 'Request body must be valid JSON' },
    ]);
  }
}
