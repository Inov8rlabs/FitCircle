'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Bell,
  Mail,
  Smartphone,
  MessageSquare,
  Trophy,
  Users,
  Activity,
  BarChart,
  Save,
  Loader2,
  ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import DashboardNav from '@/components/DashboardNav';

interface NotificationPreferences {
  // General
  push: boolean;
  email: boolean;
  sms: boolean;
  
  // Social
  challenge_invite: boolean;
  team_invite: boolean;
  comment: boolean;
  reaction: boolean;
  
  // Activity
  check_in_reminder: boolean;
  achievement: boolean;
  leaderboard_update: boolean;
  
  // Insights
  weekly_insights: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  push: true,
  email: true,
  sms: false,
  challenge_invite: true,
  team_invite: true,
  comment: true,
  reaction: true,
  check_in_reminder: true,
  achievement: true,
  leaderboard_update: true,
  weekly_insights: true,
};

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const supabase = createBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (data?.preferences?.notifications) {
        // Merge with defaults to handle new keys
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...data.preferences.notifications
        });
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const supabase = createBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) return;

      // Get current preferences first to avoid overwriting other sections
      const { data: currentData } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single();

      const updatedPreferences = {
        ...(currentData?.preferences || {}),
        notifications: preferences
      };

      const { error } = await supabase
        .from('profiles')
        .update({ preferences: updatedPreferences })
        .eq('id', user.id);

      if (error) throw error;

      toast.success('Notification settings saved');
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const togglePreference = (key: keyof NotificationPreferences) => {
    setPreferences(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
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
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => router.push('/profile')}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Bell className="h-8 w-8 text-purple-400" />
              Notifications
            </h1>
            <p className="text-gray-400 mt-1">
              Control how and when you receive updates
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* General Channels */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Mail className="h-5 w-5 text-indigo-400" />
                Channels
              </CardTitle>
              <CardDescription>Where you receive notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Push Notifications</p>
                  <p className="text-sm text-gray-400">Receive alerts on your device</p>
                </div>
                <Switch 
                  checked={preferences.push} 
                  onCheckedChange={() => togglePreference('push')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Email Notifications</p>
                  <p className="text-sm text-gray-400">Updates sent to your inbox</p>
                </div>
                <Switch 
                  checked={preferences.email} 
                  onCheckedChange={() => togglePreference('email')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">SMS Notifications</p>
                  <p className="text-sm text-gray-400">Text messages for urgent alerts</p>
                </div>
                <Switch 
                  checked={preferences.sms} 
                  onCheckedChange={() => togglePreference('sms')} 
                />
              </div>
            </CardContent>
          </Card>

          {/* Social */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-green-400" />
                Social
              </CardTitle>
              <CardDescription>Interactions with friends and teams</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Challenge Invites</p>
                  <p className="text-sm text-gray-400">When someone invites you to a challenge</p>
                </div>
                <Switch 
                  checked={preferences.challenge_invite} 
                  onCheckedChange={() => togglePreference('challenge_invite')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Team Invites</p>
                  <p className="text-sm text-gray-400">When you're invited to join a team</p>
                </div>
                <Switch 
                  checked={preferences.team_invite} 
                  onCheckedChange={() => togglePreference('team_invite')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Comments & Mentions</p>
                  <p className="text-sm text-gray-400">When someone comments on your activity</p>
                </div>
                <Switch 
                  checked={preferences.comment} 
                  onCheckedChange={() => togglePreference('comment')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Reactions</p>
                  <p className="text-sm text-gray-400">When someone reacts to your check-ins</p>
                </div>
                <Switch 
                  checked={preferences.reaction} 
                  onCheckedChange={() => togglePreference('reaction')} 
                />
              </div>
            </CardContent>
          </Card>

          {/* Activity */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-orange-400" />
                Activity & Progress
              </CardTitle>
              <CardDescription>Updates about your fitness journey</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Check-in Reminders</p>
                  <p className="text-sm text-gray-400">Daily reminders to log your progress</p>
                </div>
                <Switch 
                  checked={preferences.check_in_reminder} 
                  onCheckedChange={() => togglePreference('check_in_reminder')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Achievements</p>
                  <p className="text-sm text-gray-400">When you unlock new badges or milestones</p>
                </div>
                <Switch 
                  checked={preferences.achievement} 
                  onCheckedChange={() => togglePreference('achievement')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Leaderboard Updates</p>
                  <p className="text-sm text-gray-400">Significant changes in your rankings</p>
                </div>
                <Switch 
                  checked={preferences.leaderboard_update} 
                  onCheckedChange={() => togglePreference('leaderboard_update')} 
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30">
                <div className="flex-1">
                  <p className="text-white font-medium">Weekly Insights</p>
                  <p className="text-sm text-gray-400">Summary of your weekly performance</p>
                </div>
                <Switch 
                  checked={preferences.weekly_insights} 
                  onCheckedChange={() => togglePreference('weekly_insights')} 
                />
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <Button
              onClick={savePreferences}
              disabled={saving}
              className="bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-500/25 px-8"
              size="lg"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-5 w-5" />
                  Save Preferences
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
