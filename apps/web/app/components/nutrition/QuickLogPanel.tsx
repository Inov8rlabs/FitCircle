'use client';

import { useRouter } from 'next/navigation';

import { FoodSearch } from './FoodSearch';
import { PhotoLog } from './PhotoLog';
import { VoiceLog } from './VoiceLog';

/**
 * Quick-log entry surface — the photo / voice / search shortcuts that feed into
 * the confirm-then-commit flow. Mounted above the manual food-log form so the
 * fast paths (AI photo/voice, food DB search) are reachable wherever users go
 * to add a food entry.
 */
export function QuickLogPanel() {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div className="mb-6 rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      <h2 className="mb-3 text-base font-semibold text-white">Quick log</h2>
      <div className="space-y-3">
        <PhotoLog onLogged={refresh} />
        <VoiceLog onLogged={refresh} />
        <FoodSearch />
      </div>
      <p className="mt-3 text-xs text-gray-400">Or fill in the details manually below.</p>
    </div>
  );
}
