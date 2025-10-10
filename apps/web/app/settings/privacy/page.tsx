'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createBrowserSupabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Shield,
  Download,
  Trash2,
  Cookie,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';

interface PrivacySettings {
  analytics_enabled: boolean;
  marketing_enabled: boolean;
  do_not_sell: boolean;
}

export default function PrivacySettingsPage() {
  const [settings, setSettings] = useState<PrivacySettings>({
    analytics_enabled: false,
    marketing_enabled: false,
    do_not_sell: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const supabase = createBrowserSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { data, error } = await supabase
        .from('privacy_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows, which is expected for new users
        console.log('Using default privacy settings');
      }

      if (data) {
        setSettings({
          analytics_enabled: data.analytics_enabled,
          marketing_enabled: data.marketing_enabled,
          do_not_sell: data.do_not_sell,
        });
      }
      // If no data, use default settings (already set in state)
    } catch (error) {
      console.log('Using default privacy settings');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const supabase = createBrowserSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      // Update settings
      const { error } = await supabase.from('privacy_settings').upsert({
        user_id: user.id,
        analytics_enabled: settings.analytics_enabled,
        marketing_enabled: settings.marketing_enabled,
        do_not_sell: settings.do_not_sell,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      // Log consent changes
      await supabase.from('user_consent').insert([
        {
          user_id: user.id,
          consent_type: 'analytics',
          consent_given: settings.analytics_enabled,
          consent_version: 'privacy-policy-v1.0',
          consent_text: 'User updated analytics consent via privacy settings',
          consent_method: 'settings',
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ]);

      // Update cookie
      const consentCookie = {
        essential: true,
        analytics: settings.analytics_enabled,
        marketing: settings.marketing_enabled,
      };
      document.cookie = `fc_consent=${encodeURIComponent(JSON.stringify(consentCookie))};path=/;max-age=${365 * 24 * 60 * 60};secure;samesite=strict`;

      toast.success('Privacy settings saved successfully');

      // Reload page to apply changes
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadData = async () => {
    try {
      toast.loading('Preparing your data export...');
      const response = await fetch('/api/privacy/export');

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fitcircle-data-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('Your data has been downloaded');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download data');
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      '⚠️ WARNING: This will permanently delete your account and ALL your data.\n\n' +
        'This includes:\n' +
        '• Your profile and settings\n' +
        '• All weight and fitness tracking data\n' +
        '• Challenge participation history\n' +
        '• Notifications and preferences\n\n' +
        'This action CANNOT be undone.\n\n' +
        'Type your email to confirm deletion.'
    );

    if (!confirmed) return;

    const emailConfirm = window.prompt('Please enter your email address to confirm:');

    if (!emailConfirm) return;

    try {
      const supabase = createBrowserSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || emailConfirm !== user.email) {
        toast.error('Email does not match');
        return;
      }

      toast.loading('Deleting your account...');

      const response = await fetch('/api/privacy/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: emailConfirm }),
      });

      if (response.ok) {
        toast.success('Your account has been deleted');
        // Sign out and redirect
        await supabase.auth.signOut();
        router.push('/');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to delete account');
      }
    } catch (error) {
      console.error('Deletion error:', error);
      toast.error('Failed to delete account');
    }
  };

  const handleCCPAOptOut = async (optOut: boolean) => {
    try {
      const response = await fetch('/api/ccpa/do-not-sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optOut }),
      });

      if (response.ok) {
        setSettings({ ...settings, do_not_sell: optOut, analytics_enabled: !optOut });
        toast.success(optOut ? 'Opted out of data sharing' : 'Opted into data sharing');
      } else {
        toast.error('Failed to update preference');
      }
    } catch (error) {
      console.error('CCPA opt-out error:', error);
      toast.error('Failed to update preference');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <DashboardNav />
        <div className="flex items-center justify-center h-screen">
          <p className="text-white">Loading privacy settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <DashboardNav />

      <div className="max-w-4xl mx-auto p-6 pt-24 space-y-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Shield className="h-10 w-10 text-purple-400" />
            Privacy & Data Settings
          </h1>
          <p className="text-slate-400 text-lg">
            Manage your data, cookies, and privacy preferences
          </p>
        </div>

        {/* Cookie Preferences */}
        <Card className="bg-slate-900/50 border-slate-700 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Cookie className="h-5 w-5 text-purple-400" />
              Cookie Preferences
            </CardTitle>
            <CardDescription>Control how we use cookies and tracking</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="flex-1">
                <p className="font-medium text-white flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                  Essential Cookies
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  Required for authentication and core functionality
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={true} disabled />
                <span className="text-xs text-green-400 font-medium">Always On</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-indigo-500/50 transition-colors">
              <div className="flex-1">
                <p className="font-medium text-white">Analytics Cookies</p>
                <p className="text-sm text-slate-400 mt-1">
                  Help us improve FitCircle by tracking usage (Amplitude)
                </p>
              </div>
              <Switch
                checked={settings.analytics_enabled}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, analytics_enabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700 opacity-50">
              <div className="flex-1">
                <p className="font-medium text-white">Marketing Cookies</p>
                <p className="text-sm text-slate-400 mt-1">
                  Currently not used on FitCircle
                </p>
              </div>
              <Switch
                checked={settings.marketing_enabled}
                disabled
              />
            </div>

            <Button
              onClick={saveSettings}
              disabled={saving}
              className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600"
            >
              {saving ? 'Saving...' : 'Save Cookie Preferences'}
            </Button>
          </CardContent>
        </Card>

        {/* CCPA Rights (California Residents) */}
        <Card className="bg-slate-900/50 border-slate-700 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <FileText className="h-5 w-5 text-orange-400" />
              California Privacy Rights (CCPA)
            </CardTitle>
            <CardDescription>For California residents only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700">
              <div className="flex-1">
                <p className="font-medium text-white">Do Not Sell My Personal Information</p>
                <p className="text-sm text-slate-400 mt-1">
                  Opt out of data sharing with third parties (Amplitude analytics)
                </p>
              </div>
              <Switch
                checked={settings.do_not_sell}
                onCheckedChange={handleCCPAOptOut}
              />
            </div>
          </CardContent>
        </Card>

        {/* Your Data Rights (GDPR) */}
        <Card className="bg-slate-900/50 border-slate-700 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Shield className="h-5 w-5 text-cyan-400" />
              Your Data Rights
            </CardTitle>
            <CardDescription>Access, download, or delete your data (GDPR)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={handleDownloadData}
              variant="outline"
              className="w-full border-slate-600 text-white hover:bg-slate-800 justify-start"
            >
              <Download className="h-4 w-4 mr-2" />
              Download My Data (JSON Export)
            </Button>

            <Button
              onClick={handleDeleteAccount}
              variant="outline"
              className="w-full border-red-900/50 text-red-400 hover:bg-red-950/30 hover:border-red-800 justify-start"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete My Account Permanently
            </Button>

            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>
                  Account deletion is permanent and cannot be undone. All your data will be erased
                  within 30 days as required by GDPR.
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Privacy Policy Link */}
        <Card className="bg-slate-900/50 border-slate-700 backdrop-blur">
          <CardContent className="p-6">
            <a
              href="/privacy"
              target="_blank"
              className="flex items-center justify-between text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              <span className="font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Read our Privacy Policy
              </span>
              <ExternalLink className="h-4 w-4" />
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
