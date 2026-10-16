'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { UnsubscribeView, type UnsubscribeState as State } from '@/components/referrals/UnsubscribeView';

/**
 * Public one-click opt-out from invite emails (docs/REFERRALS_SPEC.md §9.1):
 * /invite/unsubscribe?t=<signed token> → confirm button → POST /api/referrals/unsubscribe?t=.
 * Public in middleware.ts even though /invite itself requires sign-in.
 */
function Unsubscribe() {
  const token = useSearchParams().get('t');
  const [state, setState] = useState<State>(token ? 'confirm' : 'invalid');

  // Opting out is an explicit tap (POST): mail scanners that prefetch the link
  // or even run its JavaScript must never unsubscribe anyone.
  const confirm = () => {
    if (!token) return;
    setState('loading');
    fetch(`/api/referrals/unsubscribe?t=${encodeURIComponent(token)}`, { method: 'POST', cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (res.ok && body?.success !== false) setState('done');
        else setState(res.status >= 500 ? 'error' : 'invalid');
      })
      .catch(() => setState('error'));
  };

  return <UnsubscribeView state={state} onConfirm={confirm} />;
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<UnsubscribeView state="loading" />}>
      <Unsubscribe />
    </Suspense>
  );
}
