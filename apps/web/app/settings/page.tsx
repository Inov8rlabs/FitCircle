'use client';

/**
 * Settings hub — single landing page with links to all settings sub-routes.
 * Mirrors iOS `SettingsView` (Display / Health / Notifications / Privacy / Data).
 */

import { motion } from 'framer-motion';
import {
  Bell, Heart, Lock, Palette, Database, ChevronRight, LogOut, User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Navbar } from '@/components/layout/navbar';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth-store';

interface Section {
  href: string;
  icon: React.ComponentType<any>;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
}

const SECTIONS: Section[] = [
  {
    href: '/profile',
    icon: User,
    iconBg: 'bg-purple-500/15',
    iconColor: 'text-purple-400',
    title: 'Profile',
    description: 'Display name, avatar, bio',
  },
  {
    href: '/settings/display',
    icon: Palette,
    iconBg: 'bg-indigo-500/15',
    iconColor: 'text-indigo-400',
    title: 'Display',
    description: 'Theme, units, language',
  },
  {
    href: '/settings/health',
    icon: Heart,
    iconBg: 'bg-red-500/15',
    iconColor: 'text-red-400',
    title: 'Health & Data',
    description: 'Sources, sync, import preferences',
  },
  {
    href: '/settings/notifications',
    icon: Bell,
    iconBg: 'bg-orange-500/15',
    iconColor: 'text-orange-400',
    title: 'Notifications',
    description: 'Email, push, in-app',
  },
  {
    href: '/settings/privacy',
    icon: Lock,
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    title: 'Privacy',
    description: 'Profile visibility, data sharing',
  },
  {
    href: '/settings/data',
    icon: Database,
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-400',
    title: 'Data',
    description: 'Export, delete account',
  },
];

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuthStore();

  const handleSignOut = async () => {
    try {
      await logout();
      router.push('/login');
    } catch {
      toast.error('Sign out failed');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {SECTIONS.map((s, idx) => (
              <Link key={s.href} href={s.href}>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                >
                  <div className={`h-10 w-10 rounded-lg ${s.iconBg} ${s.iconColor} flex items-center justify-center`}>
                    <s.icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </motion.div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-destructive/10 text-destructive py-3 font-semibold hover:bg-destructive/15 transition-colors"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </main>
    </div>
  );
}
