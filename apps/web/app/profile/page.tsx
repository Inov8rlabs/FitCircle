'use client';

/**
 * Profile — mirrors iOS ProfileView: avatar header with Edit Profile, a stats
 * strip, then inset grouped sections (Account, Goals, Health, Invite friends,
 * Settings, Support & legal) and Sign out. Goal and profile edits open sheets.
 */

import {
  Activity,
  Bell,
  Calendar,
  Crown,
  Flame,
  Footprints,
  Gift,
  HelpCircle,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Ruler,
  Scale,
  Settings,
  Shield,
  Sparkles,
  Star,
  Target,
  User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import { ProBadge } from '@/components/billing/ProBadge';
import { GroupButton, SettingsScreen } from '@/components/profile/settings-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvatarCircle, GlassCard, ListGroup, ListRow, ToneDisc, type Tone } from '@/components/ui/ios';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { UnitToggle } from '@/components/ui/unit-toggle';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { supabase } from '@/lib/supabase';
import { parseWeightToKg, weightKgToDisplay, getWeightUnit } from '@/lib/utils/units';
import { useAuthStore } from '@/stores/auth-store';

type ProfileSheet = 'edit' | 'goal-weight' | 'steps' | null;

function StatCell({ icon, tone, value, label }: { icon: typeof Flame; tone: Tone; value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 py-3 text-center">
      <ToneDisc icon={icon} tone={tone} size="sm" />
      <span className="text-title3 font-bold tabular-nums text-white">{value}</span>
      <span className="text-caption text-fg-secondary">{label}</span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { unitSystem, setUnitSystem, isLoading: isLoadingUnits } = useUnitPreference();
  const [sheet, setSheet] = useState<ProfileSheet>(null);
  const [goalWeight, setGoalWeight] = useState('');
  const [dailyStepsGoal, setDailyStepsGoal] = useState('10000');
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isSavingStepsGoal, setIsSavingStepsGoal] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    username: user?.username || '',
  });

  // Fetch current goal weight
  useEffect(() => {
    const fetchGoalWeight = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('goals')
          .eq('id', user.id)
          .single();

        if (error) throw error;

        const profileData = data as any;
        if (profileData?.goals && Array.isArray(profileData.goals)) {
          const weightGoal = profileData.goals.find((goal: any) => goal.type === 'weight');
          if (weightGoal?.target_weight_kg) {
            setGoalWeight(weightKgToDisplay(weightGoal.target_weight_kg, unitSystem).toString());
          }

          const stepsGoal = profileData.goals.find((goal: any) => goal.type === 'steps');
          if (stepsGoal?.daily_steps_target) {
            setDailyStepsGoal(stepsGoal.daily_steps_target.toString());
          }
        }
      } catch (error) {
        console.error('Error fetching goal weight:', error);
      }
    };

    void fetchGoalWeight();
  }, [user, unitSystem]);

  const handleSaveGoalWeight = async () => {
    if (!user || !goalWeight) return;

    setIsSavingGoal(true);
    try {
      const goalWeightKg = parseWeightToKg(parseFloat(goalWeight), unitSystem);

      // Get current goals
      const { data: profileData, error: fetchError } = await supabase
        .from('profiles')
        .select('goals')
        .eq('id', user.id)
        .single();

      if (fetchError) throw fetchError;

      const currentGoals = (profileData as any)?.goals || [];
      const otherGoals = Array.isArray(currentGoals)
        ? currentGoals.filter((g: any) => g.type !== 'weight')
        : [];

      const updatedGoals = [
        ...otherGoals,
        {
          type: 'weight',
          target_weight_kg: goalWeightKg,
          created_at: new Date().toISOString()
        }
      ];

      const { error: updateError } = await (supabase as any)
        .from('profiles')
        .update({ goals: updatedGoals })
        .eq('id', user.id);

      if (updateError) throw updateError;

      toast.success('Goal weight saved successfully!');
      setSheet(null);
    } catch (error) {
      console.error('Error saving goal weight:', error);
      toast.error('Failed to save goal weight');
    } finally {
      setIsSavingGoal(false);
    }
  };

  const handleSaveStepsGoal = async () => {
    if (!user || !dailyStepsGoal) return;

    setIsSavingStepsGoal(true);
    try {
      const stepsTarget = parseInt(dailyStepsGoal);

      // Get current goals
      const { data: profileData, error: fetchError } = await supabase
        .from('profiles')
        .select('goals')
        .eq('id', user.id)
        .single();

      if (fetchError) throw fetchError;

      const currentGoals = (profileData as any)?.goals || [];
      const otherGoals = Array.isArray(currentGoals)
        ? currentGoals.filter((g: any) => g.type !== 'steps')
        : [];

      const updatedGoals = [
        ...otherGoals,
        {
          type: 'steps',
          daily_steps_target: stepsTarget,
          created_at: new Date().toISOString()
        }
      ];

      const { error: updateError } = await (supabase as any)
        .from('profiles')
        .update({ goals: updatedGoals })
        .eq('id', user.id);

      if (updateError) throw updateError;

      toast.success('Steps goal saved successfully!');
      setSheet(null);
    } catch (error) {
      console.error('Error saving steps goal:', error);
      toast.error('Failed to save steps goal');
    } finally {
      setIsSavingStepsGoal(false);
    }
  };

  const handleSave = async () => {
    // TODO: Implement profile update
    toast.success('Profile updated successfully!');
    setSheet(null);
  };

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  const memberSince = (user as any)?.created_at ?? user?.joinedAt;
  const memberSinceLabel = memberSince ? new Date(memberSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown';
  const unitLabel = getWeightUnit(unitSystem);

  return (
    <SettingsScreen title="Profile" backHref={null} fitzy>
      <div className="space-y-4">
        {/* Header card */}
        <GlassCard className="flex flex-col items-center text-center sm:flex-row sm:text-left" data-testid="profile-header">
          <AvatarCircle name={user?.name || 'User'} src={user?.avatar} size={76} className="ring-4 ring-brand-purple/30" />
          <div className="mt-3 min-w-0 flex-1 sm:ml-4 sm:mt-0">
            <p className="flex items-center justify-center gap-2 text-title2 text-white sm:justify-start">
              <span className="truncate">{user?.name || 'User'}</span>
              {user?.isPremium && <ProBadge />}
            </p>
            {user?.username && <p className="text-subhead text-fg-secondary">@{user.username}</p>}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 rounded-full px-4 sm:mt-0"
            onClick={() => setSheet('edit')}
            data-testid="edit-profile"
          >
            Edit Profile
          </Button>
        </GlassCard>

        {/* Stats strip */}
        <GlassCard padded={false} className="grid grid-cols-3 divide-x divide-white/[0.06]" data-testid="profile-stats">
          <StatCell icon={Flame} tone="orange" value={user?.streak ?? 0} label="Day streak" />
          <StatCell icon={Star} tone="purple" value={user?.level ?? 1} label="Level" />
          <StatCell icon={Sparkles} tone="cyan" value={(user?.xp ?? 0).toLocaleString()} label="XP" />
        </GlassCard>
      </div>

      <div className="mt-6">
        <ListGroup title="Account">
          <ListRow icon={User} tone="purple" title="Name" value={user?.name || 'Not set'} />
          <ListRow icon={Mail} tone="indigo" title="Email" value={<span className="block max-w-[180px] truncate sm:max-w-none">{user?.email || 'Not set'}</span>} />
          <ListRow icon={Calendar} tone="slate" title="Member since" value={memberSinceLabel} />
        </ListGroup>

        <ListGroup title="Goals" footer="Goals appear on your dashboard to track your progress.">
          <ListRow
            onClick={() => setSheet('goal-weight')}
            icon={Target}
            tone="green"
            title="Goal weight"
            value={goalWeight ? `${goalWeight} ${unitLabel}` : 'Set'}
            chevron
            testId="row-goal-weight"
          />
          <ListRow
            onClick={() => setSheet('steps')}
            icon={Footprints}
            tone="indigo"
            title="Daily steps"
            value={dailyStepsGoal ? parseInt(dailyStepsGoal, 10).toLocaleString() : 'Set'}
            chevron
            testId="row-steps-goal"
          />
          <ListRow
            icon={Ruler}
            tone="cyan"
            title="Units"
            subtitle={unitSystem === 'metric' ? 'Using kilograms (kg)' : 'Using pounds (lbs)'}
            trailing={<UnitToggle value={unitSystem} onChange={setUnitSystem} isLoading={isLoadingUnits} size="sm" />}
          />
        </ListGroup>

        <ListGroup title="Health">
          <ListRow href="/settings/health" icon={Activity} tone="red" title="Health sources" subtitle="Apple Health and Health Connect" />
          <ListRow href="/body-composition" icon={Scale} tone="cyan" title="Body composition" subtitle="Private measurements and trends" />
        </ListGroup>

        <ListGroup title="Invite friends">
          <ListRow href="/invite" icon={Gift} tone="pink" title="Better together" subtitle="Invite friends and earn rewards" />
        </ListGroup>

        <ListGroup title="Settings">
          <ListRow href="/settings" icon={Settings} tone="slate" title="Settings" />
          <ListRow href="/settings/notifications" icon={Bell} tone="orange" title="Notifications" subtitle="Push and quiet hours" />
          <ListRow href="/settings/privacy" icon={Lock} tone="green" title="Privacy & Ad Choices" subtitle="Cookies, analytics and data sharing" />
          <ListRow href="/settings/billing" icon={Crown} tone="yellow" title="FitCircle Pro" subtitle="Plan and billing" />
        </ListGroup>

        <ListGroup title="Support & legal">
          <ListRow href="/support" icon={HelpCircle} tone="purple" title="Help & Support" />
          <ListRow href="/terms" icon={Shield} tone="slate" title="Terms of Use" />
          <ListRow href="/privacy" icon={Lock} tone="slate" title="Privacy Policy" />
        </ListGroup>

        <GroupButton onClick={() => void handleLogout()} destructive icon={LogOut} testId="profile-sign-out">
          Sign out
        </GroupButton>
      </div>

      {/* Edit profile */}
      <Sheet open={sheet === 'edit'} onOpenChange={(o) => setSheet(o ? 'edit' : null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Profile</SheetTitle>
            <SheetDescription>How you appear to your circles.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name" className="mb-1.5 block text-subhead text-fg-secondary">Full Name</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="username" className="mb-1.5 block text-subhead text-fg-secondary">Username</Label>
              <Input id="username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="email" className="mb-1.5 block text-subhead text-fg-secondary">Email</Label>
              <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </div>
          </div>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setSheet(null)}>Cancel</Button>
            <Button onClick={() => void handleSave()}>Save changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Goal weight */}
      <Sheet open={sheet === 'goal-weight'} onOpenChange={(o) => setSheet(o ? 'goal-weight' : null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Goal weight</SheetTitle>
            <SheetDescription>This will appear on your dashboard to track your progress.</SheetDescription>
          </SheetHeader>
          <Label htmlFor="goalWeight" className="mb-1.5 block text-subhead text-fg-secondary">
            Target Weight ({unitLabel})
          </Label>
          <Input
            id="goalWeight"
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder={unitSystem === 'metric' ? 'e.g., 75' : 'e.g., 165'}
            value={goalWeight}
            onChange={(e) => setGoalWeight(e.target.value)}
          />
          <SheetFooter>
            <Button variant="ghost" onClick={() => setSheet(null)}>Cancel</Button>
            <Button onClick={() => void handleSaveGoalWeight()} disabled={isSavingGoal || !goalWeight}>
              {isSavingGoal ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Goal'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Daily steps */}
      <Sheet open={sheet === 'steps'} onOpenChange={(o) => setSheet(o ? 'steps' : null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Daily steps goal</SheetTitle>
            <SheetDescription>Used for your daily progress ring and weekly bars.</SheetDescription>
          </SheetHeader>
          <Label htmlFor="stepsGoal" className="mb-1.5 block text-subhead text-fg-secondary">Steps per day</Label>
          <Input
            id="stepsGoal"
            type="number"
            inputMode="numeric"
            step="100"
            placeholder="e.g., 10000"
            value={dailyStepsGoal}
            onChange={(e) => setDailyStepsGoal(e.target.value)}
          />
          <SheetFooter>
            <Button variant="ghost" onClick={() => setSheet(null)}>Cancel</Button>
            <Button onClick={() => void handleSaveStepsGoal()} disabled={isSavingStepsGoal || !dailyStepsGoal}>
              {isSavingStepsGoal ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Goal'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </SettingsScreen>
  );
}
