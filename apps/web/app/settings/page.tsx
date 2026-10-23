'use client';

/**
 * Settings hub — mirrors iOS `SettingsView` section order:
 * Subscription · Health & Data · Notifications · Privacy & Safety · Display ·
 * Support & Legal · Account, then the app-info footer.
 */

import {
  Bell,
  BookOpen,
  Crown,
  Database,
  FileText,
  Heart,
  HelpCircle,
  Lock,
  LogOut,
  Mail,
  Palette,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ProBadge } from '@/components/billing/ProBadge';
import { GroupButton, SettingsScreen } from '@/components/profile/settings-shell';
import { ListGroup, ListRow } from '@/components/ui/ios';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAuthStore } from '@/stores/auth-store';

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const { isPro, entitlements } = useEntitlements();

  const handleSignOut = async () => {
    try {
      await logout();
      router.push('/login');
    } catch {
      toast.error('Sign out failed');
    }
  };

  return (
    <SettingsScreen title="Settings" backHref="/profile" backLabel="Profile">
      <div data-testid="settings-groups">
        <ListGroup title="Subscription">
          <ListRow
            href="/settings/billing"
            icon={Crown}
            tone="yellow"
            title="FitCircle Pro"
            subtitle={
              entitlements?.subscriptionsEnabled === false
                ? 'Everything is free right now'
                : 'Manage your plan and benefits'
            }
            trailing={isPro ? <ProBadge /> : undefined}
          />
        </ListGroup>

        <ListGroup title="Health & Data">
          <ListRow
            href="/settings/health"
            icon={Heart}
            tone="red"
            title="Health sources"
            subtitle="Apple Health, Health Connect and sync"
          />
          <ListRow
            href="/settings/data"
            icon={Database}
            tone="cyan"
            title="Your data"
            subtitle="Export or delete your data"
          />
        </ListGroup>

        <ListGroup title="Notifications">
          <ListRow
            href="/settings/notifications"
            icon={Bell}
            tone="orange"
            title="Notification Preferences"
            subtitle="Manage your notification settings"
          />
        </ListGroup>

        <ListGroup title="Privacy & Safety">
          <ListRow
            href="/settings/privacy"
            icon={Lock}
            tone="green"
            title="Privacy Settings"
            subtitle="Cookies, analytics and data sharing"
          />
        </ListGroup>

        <ListGroup title="Display">
          <ListRow
            href="/settings/display"
            icon={Palette}
            tone="indigo"
            title="Units & Nutrition"
            subtitle="Metric or imperial, diet preferences"
          />
        </ListGroup>

        <ListGroup title="Support & Legal">
          <ListRow href="/support" icon={HelpCircle} tone="purple" title="Help & Support" subtitle="Answers and troubleshooting" />
          <ListRow
            href="mailto:support@fitcircle.ai"
            icon={Mail}
            tone="cyan"
            title="Contact Us"
            subtitle="support@fitcircle.ai"
          />
          <ListRow href="/terms" icon={FileText} tone="slate" title="Terms of Use" />
          <ListRow href="/privacy" icon={Shield} tone="slate" title="Privacy Policy" />
          <ListRow href="/privacy/delete-account" icon={BookOpen} tone="slate" title="Account deletion policy" />
        </ListGroup>

        <ListGroup title="Account">
          <ListRow href="/profile" icon={User} tone="purple" title="Profile" subtitle="Name, goals and units" />
          <ListRow href="/settings/data" icon={Trash2} destructive title="Delete Account" subtitle="Permanently delete your account" />
        </ListGroup>

        <GroupButton onClick={() => void handleSignOut()} destructive icon={LogOut} testId="settings-sign-out">
          Sign out
        </GroupButton>

        <p className="pb-4 text-center text-footnote text-fg-tertiary">FitCircle for the web</p>
      </div>
    </SettingsScreen>
  );
}
