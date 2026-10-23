'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  LayoutDashboard,
  Users,
  Utensils,
  LogOut,
  Menu,
  X,
  User,
  ChevronDown,
  Gift,
  Megaphone,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

import { BottomNav, isNavItemActive } from '@/components/layout/bottom-nav';
import { FitzyLauncher } from '@/components/nutrition/FitzyLauncher';
import { Logo } from '@/components/ui/logo';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useAuthStore } from '@/stores/auth-store';

const navigation = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard, match: ['/dashboard'] },
  { name: 'Circles', href: '/fitcircles', icon: Users, match: ['/fitcircles', '/challenges'] },
  { name: 'Food', href: '/food-log', icon: Utensils, match: ['/food-log', '/beverage-log'] },
  { name: 'Activity', href: '/exercise-log', icon: Activity, match: ['/exercise-log', '/streaks', '/momentum', '/body-composition'] },
];

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const isAdmin = useIsAdmin();

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };

    if (profileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [profileMenuOpen]);

  const handleLogout = async () => {
    await logout();
    void router.push('/');
  };

  return (
    <>
    <nav className="sticky top-0 z-50 border-b border-hairline bg-canvas/75 backdrop-blur-xl" data-testid="app-navbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <Logo size="sm" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {navigation.map((item) => {
              const isActive = isNavItemActive(pathname, item.match);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-3.5 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${isActive
                      ? 'bg-white/10 text-white'
                      : 'text-fg-secondary hover:bg-white/5 hover:text-white'
                    }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
            <FitzyLauncher variant="nav" />
          </div>

          {/* Desktop User Menu */}
          <div className="hidden md:flex items-center gap-3 relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileMenuOpen(!profileMenuOpen)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="text-right">
                <p className="text-sm font-medium text-white">{user?.name || 'User'}</p>
                <p className="text-xs text-fg-secondary">{user?.email}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-gradient-brand flex items-center justify-center">
                <span className="text-white font-semibold text-sm">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <ChevronDown className={`w-4 h-4 text-fg-secondary transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Profile Dropdown Menu */}
            <AnimatePresence>
              {profileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full right-0 mt-2 w-56 bg-surface border border-hairline rounded-xl shadow-ios-lg overflow-hidden z-50"
                >
                  <div className="p-2">
                    <Link
                      href="/profile"
                      onClick={() => setProfileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fg-secondary hover:bg-white/5 hover:text-white transition-colors"
                    >
                      <User className="w-4 h-4" />
                      Profile & Settings
                    </Link>
                    <Link
                      href="/invite"
                      onClick={() => setProfileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fg-secondary hover:bg-white/5 hover:text-white transition-colors"
                    >
                      <Gift className="w-4 h-4 text-pink-400" />
                      Invite friends
                    </Link>
                    {isAdmin && (
                      <Link
                        href="/admin/campaigns"
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-fg-secondary hover:bg-white/5 hover:text-white transition-colors"
                      >
                        <Megaphone className="w-4 h-4 text-amber-400" />
                        Admin · Campaigns
                      </Link>
                    )}
                    <div className="my-1 border-t border-hairline" />
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false);
                        void handleLogout();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-white/5 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile actions */}
          <div className="md:hidden flex items-center gap-1">
            <FitzyLauncher variant="icon" />
          {/* Mobile Menu Button */}
          <button
            type="button"
            className="p-2 rounded-lg text-fg-secondary hover:bg-white/5 hover:text-white transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden border-t border-hairline bg-canvas"
          >
            <div className="px-4 py-4 space-y-1">
              {/* User Info - Links to Profile */}
              <Link
                href="/profile"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 p-3 mb-3 bg-surface-raised/50 rounded-xl hover:bg-white/5 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-brand flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {user?.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.name || 'User'}</p>
                  <p className="text-xs text-fg-secondary truncate">{user?.email}</p>
                </div>
                <ChevronDown className="w-5 h-5 text-fg-tertiary" />
              </Link>

              {/* Navigation Links */}
              {navigation.map((item) => {
                const isActive = isNavItemActive(pathname, item.match);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive
                        ? 'bg-white/10 text-white'
                        : 'text-fg-secondary hover:bg-white/5 hover:text-white'
                      }`}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.name}
                  </Link>
                );
              })}
              <Link
                href="/invite"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${pathname === '/invite'
                    ? 'bg-white/10 text-white'
                    : 'text-fg-secondary hover:bg-white/5 hover:text-white'
                  }`}
              >
                <Gift className="w-5 h-5 text-pink-400" />
                Invite friends
              </Link>
              {isAdmin && (
                <Link
                  href="/admin/campaigns"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${pathname?.startsWith('/admin')
                      ? 'bg-white/10 text-white'
                      : 'text-fg-secondary hover:bg-white/5 hover:text-white'
                    }`}
                >
                  <Megaphone className="w-5 h-5 text-amber-400" />
                  Admin · Campaigns
                </Link>
              )}
              <FitzyLauncher variant="mobile-row" onOpen={() => setMobileMenuOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
    {/* Outside <nav>: backdrop-filter would make it the containing block of the fixed tab bar. */}
    <BottomNav />
    </>
  );
}