// amplitude.ts
'use client';

import * as amplitude from '@amplitude/analytics-browser';
import { Identify } from '@amplitude/analytics-browser';
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser';

function initAmplitude() {
  if (typeof window !== 'undefined') {
    amplitude.add(sessionReplayPlugin());
    amplitude.init('d0229f4c11c291cb0cb2204620bc9657', {"autocapture":true});
  }
}

initAmplitude();

export const Amplitude = () => null;
export default amplitude;
