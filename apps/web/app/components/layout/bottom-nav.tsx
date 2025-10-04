'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Trophy, Plus, Users, User } from 'lucide-react';
import { cn, triggerHapticFeedback } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores/ui-store';

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/challenges', icon: Trophy, label: 'Challenges' },
  { href: '/checkin', icon: Plus, label: 'Check-in', isSpecial: true },
  { href: '/teams', icon: Users, label: 'Teams' },
  { href: '/profile', icon: User, label: 'Profile' },
];

export function BottomNav() {
  const pathname = usePathname();
  const { isBottomNavVisible } = useUIStore();

  return (
    <AnimatePresence>
      {isBottomNavVisible && (
        <motion.nav
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          exit={{ y: 100 }}
          transition={{ type: 'spring', damping: 25, stiffness: 500 }}
          className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-t border-border md:hidden safe-bottom"
        >
          <div className="grid grid-cols-5 h-16">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              if (item.isSpecial) {
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => triggerHapticFeedback('medium')}
                    className="flex flex-col items-center justify-center relative"
                  >
                    <motion.div
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="absolute -top-4 bg-primary rounded-full p-3 shadow-lg"
                    >
                      <Icon className="h-6 w-6 text-primary-foreground" />
                    </motion.div>
                  </Link>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => triggerHapticFeedback('light')}
                  className={cn(
                    'flex flex-col items-center justify-center space-y-1 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="bottomNavIndicator"
                      className="absolute bottom-0 h-0.5 w-12 bg-primary"
                      transition={{ type: 'spring', damping: 25, stiffness: 500 }}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}