'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  LayoutDashboard,
  Users,
  Trophy,
  Settings,
  LogOut,
  Menu,
  X,
  User,
  ChevronDown,
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'FitCircles', href: '/fitcircles', icon: Users },
];

export default function DashboardNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

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
    router.push('/');
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <Logo size="sm" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : 'text-gray-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* Desktop User Menu */}
          <div className="hidden md:flex items-center gap-3 relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileMenuOpen(!profileMenuOpen)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <div className="text-right">
                <p className="text-sm font-medium text-white">{user?.name || 'User'}</p>
                <p className="text-xs text-gray-400">{user?.email}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-center">
                <span className="text-white font-semibold text-sm">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Profile Dropdown Menu */}
            <AnimatePresence>
              {profileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl overflow-hidden z-50"
                >
                  <div className="p-2">
                    <Link
                      href="/profile"
                      onClick={() => setProfileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-slate-800 hover:text-white transition-colors"
                    >
                      <User className="w-4 h-4" />
                      Profile & Settings
                    </Link>
                    <div className="my-1 border-t border-slate-800" />
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false);
                        handleLogout();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-slate-800 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile Menu Button */}
          <button
            type="button"
            className="md:hidden p-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors"
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

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden border-t border-slate-800 bg-slate-950"
          >
            <div className="px-4 py-4 space-y-1">
              {/* User Info - Links to Profile */}
              <Link
                href="/profile"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 p-3 mb-3 bg-slate-900/50 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {user?.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.name || 'User'}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>

              {/* Navigation Links */}
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-500/20 text-indigo-400'
                        : 'text-gray-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
