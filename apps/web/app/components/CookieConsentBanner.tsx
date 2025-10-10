'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Shield, BarChart3, Megaphone, ChevronDown, ChevronUp } from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase';
import { initializeAmplitude } from '@/lib/amplitude';

interface ConsentPreferences {
  essential: boolean; // Always true, cannot be disabled
  analytics: boolean;
  marketing: boolean;
}

const COOKIE_NAME = 'fc_consent';
const COOKIE_EXPIRY_DAYS = 365;
const CONSENT_VERSION = 'privacy-policy-v1.0';

// Simple cookie utilities
const setCookie = (name: string, value: string, days: number) => {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  const isSecure = window.location.protocol === 'https:';
  const secureFlag = isSecure ? ';secure' : '';
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;samesite=strict${secureFlag}`;
};

const getCookie = (name: string): string | null => {
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
};

export function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [preferences, setPreferences] = useState<ConsentPreferences>({
    essential: true,
    analytics: false,
    marketing: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    console.log('🍪 CookieConsentBanner: Checking consent status...');

    // Check if user has already made a choice
    const consentCookie = getCookie(COOKIE_NAME);
    console.log('🍪 Existing consent cookie:', consentCookie || 'none');

    // Check for Global Privacy Control (GPC)
    const gpcEnabled = (navigator as any).globalPrivacyControl === true;
    if (gpcEnabled) {
      console.log('🛡️ Global Privacy Control (GPC) enabled');
    }

    if (!consentCookie) {
      if (gpcEnabled) {
        // Honor GPC signal - automatically reject non-essential cookies
        console.log('🚫 GPC detected - auto-rejecting non-essential cookies');
        handleRejectAll(true);
      } else {
        // First visit - show banner
        console.log('✅ No consent found - showing banner in 500ms');
        setTimeout(() => {
          console.log('🎉 Displaying cookie consent banner');
          setShowBanner(true);
        }, 500);
      }
    } else {
      // Load preferences from cookie
      try {
        const saved = JSON.parse(decodeURIComponent(consentCookie));
        console.log('📋 Loaded consent preferences:', saved);
        setPreferences(saved);
        initializeScripts(saved);
      } catch (e) {
        // Invalid cookie, show banner
        console.error('❌ Invalid consent cookie, showing banner:', e);
        setShowBanner(true);
      }
    }
  }, []);

  const saveConsent = async (
    prefs: ConsentPreferences,
    method: 'banner' | 'settings' | 'gpc',
    gpcSignal: boolean = false
  ) => {
    setIsSubmitting(true);

    try {
      // Save to cookie (client-side, immediate)
      const cookieValue = encodeURIComponent(JSON.stringify(prefs));
      setCookie(COOKIE_NAME, cookieValue, COOKIE_EXPIRY_DAYS);
      console.log('💾 Saved consent to cookie:', prefs);

      // Verify cookie was saved
      const savedCookie = getCookie(COOKIE_NAME);
      console.log('✅ Cookie verification:', savedCookie ? 'saved successfully' : '❌ failed to save');

      // Save to database (server-side, audit trail)
      const supabase = createBrowserSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Store consent record for each type
        const consentRecords = Object.entries(prefs).map(([type, given]) => ({
          user_id: user.id,
          consent_type: type,
          consent_given: given,
          consent_version: CONSENT_VERSION,
          consent_text: getConsentText(type),
          consent_method: method,
          gpc_signal: gpcSignal,
          expires_at: new Date(Date.now() + COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        }));

        await supabase.from('user_consent').insert(consentRecords);

        // Update privacy settings
        await supabase.from('privacy_settings').upsert({
          user_id: user.id,
          analytics_enabled: prefs.analytics,
          marketing_enabled: prefs.marketing,
          gpc_honored: gpcSignal,
          gpc_detected_at: gpcSignal ? new Date().toISOString() : null,
        });
      }

      // Initialize scripts based on consent
      initializeScripts(prefs);
      setShowBanner(false);
    } catch (error) {
      console.error('Error saving consent:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const initializeScripts = (prefs: ConsentPreferences) => {
    if (prefs.analytics) {
      // Initialize Amplitude with user consent
      try {
        initializeAmplitude();
        console.log('✅ Analytics enabled - Amplitude initialized');
      } catch (error) {
        console.error('❌ Failed to initialize analytics:', error);
      }
    } else {
      console.log('❌ Analytics disabled by user consent');
    }
    // Future: Load marketing scripts if prefs.marketing
  };

  const handleAcceptAll = () => {
    const prefs = { essential: true, analytics: true, marketing: true };
    saveConsent(prefs, 'banner');
  };

  const handleRejectAll = (gpcSignal: boolean = false) => {
    const prefs = { essential: true, analytics: false, marketing: false };
    saveConsent(prefs, gpcSignal ? 'gpc' : 'banner', gpcSignal);
  };

  const handleSavePreferences = () => {
    saveConsent(preferences, 'banner');
  };

  if (!showBanner) return null;

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6"
        >
          <div className="max-w-7xl mx-auto">
            <div className="bg-gradient-to-br from-slate-900/98 via-slate-900/95 to-slate-800/98 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
              {/* Header Section */}
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                      <Shield className="h-4 w-4 text-cyan-400" />
                      We value your privacy
                    </h3>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      We use cookies to enhance your experience and analyze site usage. Essential
                      cookies are required for the site to function. Analytics cookies help us
                      improve FitCircle.{' '}
                      <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors inline-flex items-center gap-1"
                      >
                        Customize preferences
                        {showDetails ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    </p>
                  </div>

                  {/* Action Buttons - Compact */}
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      onClick={() => handleRejectAll()}
                      variant="outline"
                      disabled={isSubmitting}
                      size="sm"
                      className="border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                    >
                      Reject All
                    </Button>
                    <Button
                      onClick={() => handleAcceptAll()}
                      disabled={isSubmitting}
                      size="sm"
                      className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white font-semibold transition-all"
                    >
                      {isSubmitting ? 'Saving...' : 'Accept All'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Detailed Settings */}
              <AnimatePresence>
                {showDetails && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="border-t border-slate-700/50 bg-slate-900/50"
                  >
                    <div className="p-6 sm:p-8 space-y-5">
                      {/* Essential Cookies */}
                      <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30">
                        <div className="flex items-start gap-3 flex-1">
                          <Shield className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-white mb-1">Essential Cookies</p>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              Required for authentication, security, and core functionality. These
                              cookies cannot be disabled.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center">
                          <Switch checked={true} disabled className="opacity-50" />
                          <span className="ml-2 text-xs text-green-400 font-medium">Always On</span>
                        </div>
                      </div>

                      {/* Analytics Cookies */}
                      <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30 hover:border-indigo-500/30 transition-colors">
                        <div className="flex items-start gap-3 flex-1">
                          <BarChart3 className="h-5 w-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-white mb-1">Analytics Cookies</p>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              Help us understand how you use FitCircle so we can improve your
                              experience. Powered by Amplitude.
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={preferences.analytics}
                          onCheckedChange={(checked) =>
                            setPreferences({ ...preferences, analytics: checked })
                          }
                          className="flex-shrink-0"
                        />
                      </div>

                      {/* Marketing Cookies */}
                      <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30 hover:border-orange-500/30 transition-colors">
                        <div className="flex items-start gap-3 flex-1">
                          <Megaphone className="h-5 w-5 text-orange-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-white mb-1">Marketing Cookies</p>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              Used to show relevant ads and content. Currently not used on FitCircle.
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={preferences.marketing}
                          onCheckedChange={(checked) =>
                            setPreferences({ ...preferences, marketing: checked })
                          }
                          disabled
                          className="flex-shrink-0 opacity-50"
                        />
                      </div>

                      {/* Save Preferences Button */}
                      <div className="flex justify-between items-center pt-2">
                        <a
                          href="/privacy"
                          target="_blank"
                          className="text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                        >
                          Read our Privacy Policy
                        </a>
                        <Button
                          onClick={() => handleSavePreferences()}
                          disabled={isSubmitting}
                          className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-semibold transition-all shadow-lg shadow-purple-500/20"
                        >
                          {isSubmitting ? 'Saving...' : 'Save Preferences'}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function getConsentText(type: string): string {
  const texts = {
    essential: 'Cookies necessary for authentication, security, and core functionality',
    analytics: 'Cookies to track usage patterns and improve user experience (Amplitude Analytics, Session Replay)',
    marketing: 'Cookies for targeted advertising and marketing campaigns',
  };
  return texts[type as keyof typeof texts] || '';
}
