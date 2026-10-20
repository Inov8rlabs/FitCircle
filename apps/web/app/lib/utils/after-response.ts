/**
 * Run best-effort work after the response has been sent, via Next's `after()`
 * (stable since Next 15.1; on Vercel the function stays alive until it finishes).
 *
 * Failures are logged, never thrown. Outside a request scope (scripts, unit
 * tests that don't mock next/server) `after()` throws, so the task just runs
 * detached instead.
 */
import { after } from 'next/server';

export function runAfterResponse(task: () => Promise<unknown> | unknown, label = 'task'): void {
  const run = () =>
    Promise.resolve()
      .then(task)
      .catch((err: any) => console.error(`[after-response] ${label} failed:`, err?.message ?? err));
  try {
    after(run);
  } catch {
    void run();
  }
}
