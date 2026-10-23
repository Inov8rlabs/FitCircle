'use client';

import { motion } from 'framer-motion';
import { Activity, Home, User, Users, Utensils } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn, triggerHapticFeedback } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';

/**
 * The iOS tab bar (MainTabView: Home · Circles · Food · Activity · Profile)
 * as a floating pill on phones. Every destination is a real route; the old
 * /checkin and /teams items pointed at pages that don't exist.
 */
export const BOTTOM_NAV_ITEMS = [
  { href: '/dashboard', icon: Home, label: 'Home', match: ['/dashboard'] },
  { href: '/fitcircles', icon: Users, label: 'Circles', match: ['/fitcircles', '/challenges', '/join'] },
  { href: '/food-log', icon: Utensils, label: 'Food', match: ['/food-log', '/beverage-log'] },
  { href: '/exercise-log', icon: Activity, label: 'Activity', match: ['/exercise-log', '/streaks', '/momentum', '/body-composition'] },
  { href: '/profile', icon: User, label: 'Profile', match: ['/profile', '/settings', '/invite', '/upgrade'] },
] as const;

export function isNavItemActive(pathname: string | null, match: readonly string[]): boolean {
  if (!pathname) return false;
  return match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

/** Full-screen flows where the tab bar would cover the primary action. */
const HIDDEN_ON = [/^\/onboarding/, /^\/food-log\/new/, /^\/exercise-log\/new/, /^\/fitcircles\/[^/]+\/checkin/, /^\/admin/];

export function BottomNav() {
  const pathname = usePathname();
  const { isBottomNavVisible } = useUIStore();
  if (!isBottomNavVisible || HIDDEN_ON.some((re) => re.test(pathname ?? ''))) return null;

  return (
    <nav
      aria-label="Primary"
      data-bottom-nav
      data-testid="bottom-nav"
      className="fixed inset-x-3 z-50 md:hidden"
      style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}
    >
      <ul className="grid h-16 grid-cols-5 rounded-full border border-glass bg-surface/85 px-1.5 shadow-ios-lg backdrop-blur-xl">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isNavItemActive(pathname, item.match);
          return (
            <li key={item.href} className="relative flex">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => triggerHapticFeedback('light')}
                className={cn(
                  'relative z-10 m-1.5 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full transition-colors duration-200 ease-ios',
                  active ? 'text-white' : 'text-fg-tertiary hover:text-fg-secondary'
                )}
              >
                {active && (
                  <motion.span
                    layoutId="bottomNavPill"
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-full bg-white/10"
                    transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                  />
                )}
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                <span className="text-[10px] font-semibold leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
