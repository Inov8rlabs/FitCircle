/**
 * `X-Analysis-Job-Id` (docs/ENGAGEMENT_115_CLIENT_CONTRACT.md §2, ENGAGEMENT_115_SPEC §14.4 item 3).
 *
 * Optional request header on POST /api/mobile/food/photo-parse, voice-parse and estimate-item:
 * the client's id for ONE analysis attempt of one capture (a UUID is ideal). A repeat call with
 * the same id within FOOD_AI_REPEAT_WINDOW_MS (a queue retry, a background-session resend, a
 * resume) never costs a second free scan. Additive: absent or malformed → ignored (never an error),
 * so shipped clients are unaffected.
 */
export const ANALYSIS_JOB_ID_HEADER = 'x-analysis-job-id';
/** 8–64 chars of [A-Za-z0-9_-] (a UUID with or without dashes fits). */
export const ANALYSIS_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** The validated job id, or undefined (absent / malformed). Case-insensitive: lower-cased. */
export function parseAnalysisJobId(raw: string | null | undefined): string | undefined {
  const v = (raw ?? '').trim();
  return ANALYSIS_JOB_ID_PATTERN.test(v) ? v.toLowerCase() : undefined;
}

export function readAnalysisJobId(request: { headers: { get(name: string): string | null } }): string | undefined {
  return parseAnalysisJobId(request.headers.get(ANALYSIS_JOB_ID_HEADER));
}
