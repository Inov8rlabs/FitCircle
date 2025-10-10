// amplitude.ts
'use client';

import * as amplitude from '@amplitude/analytics-browser';
import { Identify } from '@amplitude/analytics-browser';
import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser';

let initialized = false;
let consentGiven = false;

// Cookie utility to check consent
const getCookie = (name: string): string | null => {
  if (typeof window === 'undefined') return null;
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
};

// Check if analytics consent is given
function checkConsent(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const consentCookie = getCookie('fc_consent');
    if (consentCookie) {
      const consent = JSON.parse(decodeURIComponent(consentCookie));
      return consent.analytics === true;
    }
  } catch (e) {
    console.warn('Failed to parse consent cookie:', e);
  }

  return false;
}

// Initialize Amplitude (called after consent is given)
function initAmplitude() {
  if (typeof window === 'undefined' || initialized) return;

  // Double-check consent
  if (!checkConsent()) {
    console.warn('⚠️ Amplitude initialization blocked - no analytics consent');
    return;
  }

  console.log('🚀 Initializing Amplitude with user consent...');

  amplitude.add(sessionReplayPlugin());
  amplitude.init('d0229f4c11c291cb0cb2204620bc9657', {
    autocapture: true,
  });

  initialized = true;
  consentGiven = true;

  console.log('✅ Amplitude initialized successfully');
}

// DO NOT auto-initialize - wait for explicit consent
// initAmplitude(); // REMOVED - violates GDPR

// Check on module load if consent already exists (for returning visitors)
if (typeof window !== 'undefined') {
  const hasConsent = checkConsent();
  if (hasConsent) {
    // User previously gave consent, initialize Amplitude
    initAmplitude();
  } else {
    console.log('⏳ Amplitude waiting for user consent...');
  }
}

// Export function to manually initialize after consent
export const initializeAmplitude = () => {
  if (!initialized && checkConsent()) {
    initAmplitude();
  }
};

// Export null component (for compatibility)
export const Amplitude = () => null;

// Create a proxy wrapper that checks consent before tracking
const amplitudeProxy = new Proxy(amplitude, {
  get(target: any, prop: string) {
    // Allow non-tracking methods
    const allowedMethods = ['setUserId', 'getUserId', 'getSessionId', 'getDeviceId'];

    if (allowedMethods.includes(prop)) {
      return target[prop];
    }

    // For tracking methods, check consent
    return (...args: any[]) => {
      if (!initialized || !consentGiven) {
        console.warn(
          `⚠️ Amplitude.${prop}() blocked - analytics consent required. Visit privacy settings to enable.`
        );
        return;
      }
      return target[prop](...args);
    };
  },
});

// Export the consent-aware proxy as default
export default amplitudeProxy;

// Also export individual items for named imports
export { Identify };
