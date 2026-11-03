/**
 * Android commit SHAs (docs/RELEASES_TRACKER_SPEC.md §3.2.1). Google Play does not
 * know commits and the Android repo is private (no GitHub token in the backend),
 * so the Android release script records them at build time:
 * Fitcircle-Android scripts/play-release.sh writes releases/<versionCode>/COMMIT
 * (`git log -1 --format=%H%n%cs%n%s` of the clean HEAD it built, plus a
 * `dirty` line when built with ALLOW_DIRTY=1).
 *
 * `recordAndroidCommits` fills those into every android row with that build
 * (any track), only where `commits` is empty. The sync also copies commits to a
 * new track row (e.g. play_production:N) from a sibling with the same versionCode.
 */
import { chunk, db } from '@/lib/ads/services/db';

import { planFill } from '../status';
import type { ReleaseCommit } from '../types';

import { applyFill } from './sync-service';

export const ANDROID_REPO = 'Fitcircle-Android';

/** Parse a releases/<N>/COMMIT file. Null when it is not a full sha + date + subject. */
export function parseAndroidCommitFile(text: string): ReleaseCommit | null {
  const [sha, date, subject, ...rest] = text.replace(/\r/g, '').split('\n');
  const s = (sha ?? '').trim().toLowerCase();
  const d = (date ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const dirty = rest.some((l) => l.trim() === 'dirty');
  const subj = (subject ?? '').trim().slice(0, 450);
  return { sha: s, subject: dirty ? `${subj} (built from a dirty tree)` : subj, repo: ANDROID_REPO, date: d };
}

export interface AndroidCommitResult {
  build: string;
  filled: string[];
  kept: string[];
}

/** Fill-if-empty: per versionCode, every android release row with that build. Idempotent. */
export async function recordAndroidCommits(entries: Array<{ build: string; commit: ReleaseCommit }>, now = new Date()): Promise<AndroidCommitResult[]> {
  const supabase = db();
  const nowIso = now.toISOString();
  const byBuild = new Map(entries.filter((e) => /^\d+$/.test(e.build)).map((e) => [e.build, e.commit]));
  const out: AndroidCommitResult[] = [];
  for (const part of chunk([...byBuild.keys()], 200)) {
    const { data, error } = await supabase.from('releases').select('id, release_key, build, commits, links').eq('platform', 'android').in('build', part);
    if (error) throw new Error(`releases read: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; release_key: string; build: string; commits: unknown; links: unknown }>;
    for (const build of part) {
      const res: AndroidCommitResult = { build, filled: [], kept: [] };
      for (const r of rows.filter((x) => x.build === build)) {
        const fill = planFill(r, { commits: [byBuild.get(build)!] });
        if (!fill) {
          res.kept.push(r.release_key);
          continue;
        }
        await applyFill(r.id, fill, r.links, nowIso);
        res.filled.push(r.release_key);
      }
      out.push(res);
    }
  }
  return out;
}
