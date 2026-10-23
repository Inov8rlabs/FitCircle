'use client';

import {
  Shield,
  Download,
  Trash2,
  Cookie,
  AlertTriangle,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import { SettingsScreen, ToggleRow } from '@/components/profile/settings-shell';
import { Button } from '@/components/ui/button';
import { ListGroup, ListRow } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { createBrowserSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';


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
    void loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const supabase = createBrowserSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        void router.push('/login');
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
      // Apply immediately: revoking opts every provider out, granting starts them.
      analytics.setOptOut(!settings.analytics_enabled);

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
      analytics.track(AnalyticsEvents.dataExportRequested());
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
        analytics.track(AnalyticsEvents.accountDeleted());
        // Sign out (tracks Logout before analytics reset) and redirect
        useAuthStore.getState().logout('account_deleted');
        await supabase.auth.signOut();
        void router.push('/');
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
        if (optOut) analytics.setOptOut(true);
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

  return (
    <SettingsScreen title="Privacy" subtitle="Manage your data, cookies, and privacy preferences">
      {loading ? (
        <div role="status" aria-label="Loading" className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[64px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <ListGroup title="Cookie preferences" footer="Control how we use cookies and tracking.">
            <ToggleRow
              id="essential"
              icon={CheckCircle2}
              tone="green"
              title="Essential cookies"
              description="Required for authentication and core functionality"
              checked
              disabled
              trailingNote="Always on"
            />
            <ToggleRow
              id="analytics"
              icon={Cookie}
              tone="purple"
              title="Analytics cookies"
              description="Help us improve FitCircle by tracking usage (Amplitude)"
              checked={settings.analytics_enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, analytics_enabled: checked })}
            />
            <ToggleRow
              id="marketing"
              icon={Cookie}
              tone="slate"
              title="Marketing cookies"
              description="Currently not used on FitCircle"
              checked={settings.marketing_enabled}
              disabled
            />
          </ListGroup>
          <Button onClick={saveSettings} disabled={saving} size="lg" fullWidth className="mb-6">
            {saving ? 'Saving...' : 'Save Cookie Preferences'}
          </Button>

          <ListGroup title="California privacy rights (CCPA)" footer="For California residents only.">
            <ToggleRow
              id="do_not_sell"
              icon={FileText}
              tone="orange"
              title="Do Not Sell My Personal Information"
              description="Opt out of data sharing with third parties (Amplitude analytics)"
              checked={settings.do_not_sell}
              onCheckedChange={handleCCPAOptOut}
            />
          </ListGroup>

          <ListGroup
            title="Your data rights"
            footer={
              <span className="inline-flex items-start gap-1.5 text-brand-yellow/90">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Account deletion is permanent and cannot be undone. All your data will be erased within 30 days as
                required by GDPR.
              </span>
            }
          >
            <ListRow
              onClick={() => void handleDownloadData()}
              icon={Download}
              tone="cyan"
              title="Download My Data"
              subtitle="JSON export (GDPR)"
              testId="privacy-download"
            />
            <ListRow
              onClick={() => void handleDeleteAccount()}
              icon={Trash2}
              destructive
              title="Delete My Account Permanently"
              testId="privacy-delete"
            />
          </ListGroup>

          <ListGroup>
            <ListRow href="/privacy" icon={Shield} tone="slate" title="Read our Privacy Policy" />
          </ListGroup>
        </>
      )}
    </SettingsScreen>
  );
}
