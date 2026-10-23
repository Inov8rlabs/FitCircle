'use client';

import {
  BarChart,
  Flame,
  MessageSquare,
  Moon,
  PartyPopper,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { InfoNote, SettingsScreen, ToggleRow } from '@/components/profile/settings-shell';
import { ListGroup, type Tone } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { createBrowserSupabase } from '@/lib/supabase';

/**
 * Push notification preferences. These are the six categories the backend
 * NotificationOrchestrator checks before every send (notification_preferences
 * table), plus quiet hours. Pushes are delivered to the iOS and Android apps;
 * this page is the web surface for the same settings.
 */
type CategoryKey =
  | 'momentum_enabled'
  | 'circle_enabled'
  | 'challenge_enabled'
  | 'social_enabled'
  | 'celebration_enabled'
  | 'journey_enabled'
  | 'coach_enabled';

interface PushPreferences {
  momentum_enabled: boolean;
  circle_enabled: boolean;
  challenge_enabled: boolean;
  social_enabled: boolean;
  celebration_enabled: boolean;
  journey_enabled: boolean;
  coach_enabled: boolean;
  quiet_hours_start: string | null; // "HH:MM"
  quiet_hours_end: string | null;
  quiet_hours_timezone: string;
}

const browserTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';

const DEFAULT_PREFERENCES: PushPreferences = {
  momentum_enabled: true,
  circle_enabled: true,
  challenge_enabled: true,
  social_enabled: true,
  celebration_enabled: true,
  journey_enabled: true,
  coach_enabled: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_timezone: 'America/New_York',
};

const DEFAULT_QUIET_START = '22:00';
const DEFAULT_QUIET_END = '07:00';

const CATEGORIES: Array<{
  key: CategoryKey;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: Tone;
}> = [
  {
    key: 'momentum_enabled',
    label: 'Streak reminders',
    description: "Lunch and dinner logging nudges, a heads-up when your streak is at risk, and when a streak is lost or a shield saves it",
    icon: Flame,
    tone: 'orange',
  },
  {
    key: 'circle_enabled',
    label: 'Circle activity',
    description: 'When your circle has a perfect day or someone joins',
    icon: Users,
    tone: 'green',
  },
  {
    key: 'challenge_enabled',
    label: 'Challenges',
    description: 'Daily challenge drops and challenge results',
    icon: Trophy,
    tone: 'indigo',
  },
  {
    key: 'social_enabled',
    label: 'Chat and invites',
    description: 'Messages and mentions in circle chat, circle invites',
    icon: MessageSquare,
    tone: 'cyan',
  },
  {
    key: 'celebration_enabled',
    label: 'Celebrations',
    description: 'Milestones, shields earned, and circle rallies',
    icon: PartyPopper,
    tone: 'purple',
  },
  {
    key: 'journey_enabled',
    label: 'Tips and summaries',
    description: 'Your weekly review and occasional tips',
    icon: BarChart,
    tone: 'pink',
  },
  {
    key: 'coach_enabled',
    label: 'Coaching tips from Fitzy',
    description: "Today's focus each morning and the occasional well-timed tip from your coach",
    icon: Sparkles,
    tone: 'purple',
  },
];

/** Row shape of notification_preferences as returned by Supabase. */
interface PreferencesRow {
  momentum_enabled: boolean | null;
  circle_enabled: boolean | null;
  challenge_enabled: boolean | null;
  social_enabled: boolean | null;
  celebration_enabled: boolean | null;
  journey_enabled: boolean | null;
  /** Migration 107. */
  coach_enabled?: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
}

// "HH:MM:SS" from Postgres TIME → "HH:MM" for <input type="time">.
const toHHMM = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 5) : null;

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createBrowserSupabase();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          void router.push('/login');
          return;
        }
        setUserId(user.id);

        const { data: row, error } = await supabase
          .from('notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        const data = row as PreferencesRow | null;

        if (data) {
          setPreferences({
            momentum_enabled: data.momentum_enabled ?? true,
            circle_enabled: data.circle_enabled ?? true,
            challenge_enabled: data.challenge_enabled ?? true,
            social_enabled: data.social_enabled ?? true,
            celebration_enabled: data.celebration_enabled ?? true,
            journey_enabled: data.journey_enabled ?? true,
            coach_enabled: data.coach_enabled ?? true,
            quiet_hours_start: toHHMM(data.quiet_hours_start),
            quiet_hours_end: toHHMM(data.quiet_hours_end),
            quiet_hours_timezone: data.quiet_hours_timezone || browserTimezone(),
          });
        } else {
          setPreferences({ ...DEFAULT_PREFERENCES, quiet_hours_timezone: browserTimezone() });
        }
      } catch (error) {
        console.error('Error loading notification preferences:', error);
        toast.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [router]);

  /**
   * Persist a partial change immediately (autosave). Optimistic: the UI
   * updates first and reverts if the write fails.
   */
  const save = useCallback(
    async (patch: Partial<PushPreferences>, savingLabel: string) => {
      if (!userId) return;
      const previous = preferences;
      const next: PushPreferences = {
        ...preferences,
        ...patch,
        quiet_hours_timezone: browserTimezone(),
      };
      setPreferences(next);
      setSavingKey(savingLabel);
      try {
        const supabase = createBrowserSupabase();
        const { error } = await supabase
          .from('notification_preferences')
          .upsert(
            { user_id: userId, ...next, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          );
        if (error) throw error;
        if (savingLabel === 'quiet') {
          analytics.track(
            AnalyticsEvents.notificationSettingsChanged({
              setting: 'quiet_hours',
              enabled: patch.quiet_hours_start != null,
            })
          );
        } else {
          for (const [setting, enabled] of Object.entries(patch)) {
            if (typeof enabled === 'boolean') {
              analytics.track(AnalyticsEvents.notificationSettingsChanged({ setting, enabled }));
            }
          }
        }
      } catch (error) {
        console.error('Error saving notification preferences:', error);
        setPreferences(previous);
        toast.error('Could not save that change. Please try again.');
      } finally {
        setSavingKey(null);
      }
    },
    [preferences, userId]
  );

  const quietHoursOn = preferences.quiet_hours_start !== null && preferences.quiet_hours_end !== null;

  const toggleQuietHours = (on: boolean) => {
    void save(
      on
        ? { quiet_hours_start: DEFAULT_QUIET_START, quiet_hours_end: DEFAULT_QUIET_END }
        : { quiet_hours_start: null, quiet_hours_end: null },
      'quiet'
    );
  };

  return (
    <SettingsScreen
      title="Notifications"
      subtitle="Choose which push notifications reach your phone"
    >
      <InfoNote icon={Smartphone} tone="indigo">
        Push notifications are delivered to the FitCircle app on your iPhone or Android phone. Changes
        here apply everywhere you&apos;re signed in. Chat messages are never held back by the daily limit.
      </InfoNote>

      {loading ? (
        <div role="status" aria-label="Loading" className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-[64px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <ListGroup title="What you get notified about" footer="Turn off any group you don't want.">
            {CATEGORIES.map(({ key, label, description, icon, tone }) => (
              <ToggleRow
                key={key}
                id={key}
                icon={icon}
                tone={tone}
                title={label}
                description={description}
                checked={preferences[key]}
                disabled={savingKey === key}
                onCheckedChange={(checked) => {
                  void save({ [key]: checked } as Partial<PushPreferences>, key);
                }}
              />
            ))}
          </ListGroup>

          <ListGroup
            title="Quiet hours"
            footer={`Nothing is sent during this window, in your local time (${preferences.quiet_hours_timezone}).`}
          >
            <ToggleRow
              id="quiet_hours_enabled"
              icon={Moon}
              tone="indigo"
              title="Pause notifications overnight"
              description={
                quietHoursOn
                  ? `Quiet from ${preferences.quiet_hours_start} to ${preferences.quiet_hours_end}`
                  : 'Off'
              }
              checked={quietHoursOn}
              disabled={savingKey === 'quiet'}
              onCheckedChange={toggleQuietHours}
            />
            {quietHoursOn && (
              <li className="grid grid-cols-2 gap-3 px-4 py-3">
                <label className="flex flex-col gap-1 text-footnote text-fg-secondary">
                  Start
                  <input
                    id="quiet_hours_start"
                    type="time"
                    value={preferences.quiet_hours_start ?? DEFAULT_QUIET_START}
                    onChange={(e) => {
                      if (e.target.value) void save({ quiet_hours_start: e.target.value }, 'quiet');
                    }}
                    className="h-11 rounded-lg border border-hairline bg-white/5 px-3 text-body text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple/40"
                  />
                </label>
                <label className="flex flex-col gap-1 text-footnote text-fg-secondary">
                  End
                  <input
                    id="quiet_hours_end"
                    type="time"
                    value={preferences.quiet_hours_end ?? DEFAULT_QUIET_END}
                    onChange={(e) => {
                      if (e.target.value) void save({ quiet_hours_end: e.target.value }, 'quiet');
                    }}
                    className="h-11 rounded-lg border border-hairline bg-white/5 px-3 text-body text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple/40"
                  />
                </label>
              </li>
            )}
          </ListGroup>
        </>
      )}
    </SettingsScreen>
  );
}
