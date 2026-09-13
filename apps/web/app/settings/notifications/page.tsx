'use client';

import {
  Bell,
  Flame,
  Users,
  Trophy,
  MessageSquare,
  PartyPopper,
  BarChart,
  Moon,
  Smartphone,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import DashboardNav from '@/components/DashboardNav';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
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
  | 'journey_enabled';

interface PushPreferences {
  momentum_enabled: boolean;
  circle_enabled: boolean;
  challenge_enabled: boolean;
  social_enabled: boolean;
  celebration_enabled: boolean;
  journey_enabled: boolean;
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
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = [
  {
    key: 'momentum_enabled',
    label: 'Streak reminders',
    description: "Lunch and dinner logging nudges, a heads-up when your streak is at risk, and when a streak is lost or a shield saves it",
    icon: Flame,
    color: 'text-orange-400',
  },
  {
    key: 'circle_enabled',
    label: 'Circle activity',
    description: 'When your circle has a perfect day or someone joins',
    icon: Users,
    color: 'text-green-400',
  },
  {
    key: 'challenge_enabled',
    label: 'Challenges',
    description: 'Daily challenge drops and challenge results',
    icon: Trophy,
    color: 'text-indigo-400',
  },
  {
    key: 'social_enabled',
    label: 'Chat and invites',
    description: 'Messages and mentions in circle chat, circle invites',
    icon: MessageSquare,
    color: 'text-cyan-400',
  },
  {
    key: 'celebration_enabled',
    label: 'Celebrations',
    description: 'Milestones, shields earned, and circle rallies',
    icon: PartyPopper,
    color: 'text-purple-400',
  },
  {
    key: 'journey_enabled',
    label: 'Tips and summaries',
    description: 'Your weekly review and occasional tips',
    icon: BarChart,
    color: 'text-pink-400',
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <DashboardNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="mb-8 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void router.push('/profile');
            }}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Bell className="h-8 w-8 text-purple-400" />
              Notifications
            </h1>
            <p className="text-gray-400 mt-1">Choose which push notifications reach your phone</p>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3 text-sm text-gray-400">
                <Smartphone className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                <p>
                  Push notifications are delivered to the FitCircle app on your iPhone or
                  Android phone. Changes here apply everywhere you&apos;re signed in. Chat
                  messages are never held back by the daily limit.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white text-lg">What you get notified about</CardTitle>
              <CardDescription>Turn off any group you don&apos;t want</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {CATEGORIES.map(({ key, label, description, icon: Icon, color }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-800/30"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Icon className={`h-5 w-5 ${color} shrink-0 mt-0.5`} />
                    <div className="min-w-0">
                      <p className="text-white font-medium">{label}</p>
                      <p className="text-sm text-gray-400">{description}</p>
                    </div>
                  </div>
                  <Switch
                    id={key}
                    checked={preferences[key]}
                    disabled={savingKey === key}
                    onCheckedChange={(checked) => {
                      void save({ [key]: checked } as Partial<PushPreferences>, key);
                    }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Moon className="h-5 w-5 text-indigo-400" />
                Quiet hours
              </CardTitle>
              <CardDescription>
                Nothing is sent during this window, in your local time ({preferences.quiet_hours_timezone})
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-800/30">
                <div>
                  <p className="text-white font-medium">Pause notifications overnight</p>
                  <p className="text-sm text-gray-400">
                    {quietHoursOn
                      ? `Quiet from ${preferences.quiet_hours_start} to ${preferences.quiet_hours_end}`
                      : 'Off'}
                  </p>
                </div>
                <Switch
                  id="quiet_hours_enabled"
                  checked={quietHoursOn}
                  disabled={savingKey === 'quiet'}
                  onCheckedChange={toggleQuietHours}
                />
              </div>
              {quietHoursOn && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-800/30">
                  <label className="flex flex-col gap-1 text-sm text-gray-400">
                    Start
                    <input
                      id="quiet_hours_start"
                      type="time"
                      value={preferences.quiet_hours_start ?? DEFAULT_QUIET_START}
                      onChange={(e) => {
                        if (e.target.value) void save({ quiet_hours_start: e.target.value }, 'quiet');
                      }}
                      className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-gray-400">
                    End
                    <input
                      id="quiet_hours_end"
                      type="time"
                      value={preferences.quiet_hours_end ?? DEFAULT_QUIET_END}
                      onChange={(e) => {
                        if (e.target.value) void save({ quiet_hours_end: e.target.value }, 'quiet');
                      }}
                      className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                    />
                  </label>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
