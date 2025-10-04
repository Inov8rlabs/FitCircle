'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Search, Menu, X, ChevronDown } from 'lucide-react';
import { cn, triggerHapticFeedback } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import { motion, AnimatePresence } from 'framer-motion';

export function Navbar() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const { notifications, unreadCount } = useUIStore();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/challenges', label: 'Challenges' },
    { href: '/teams', label: 'Teams' },
    { href: '/coach', label: 'AI Coach' },
  ];

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-40 transition-all duration-300 safe-top',
        isScrolled
          ? 'bg-background/80 backdrop-blur-lg border-b border-border'
          : 'bg-background border-b border-transparent'
      )}
    >
      <nav className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center space-x-8">
          <Link
            href="/"
            className="flex items-center space-x-2 font-bold text-xl"
            onClick={() => triggerHapticFeedback('light')}
          >
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
              <span className="text-primary-foreground text-xl italic font-serif" style={{ fontFamily: 'Georgia, serif' }}>f</span>
            </div>
            <span className="hidden sm:inline">FitCircle</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center space-x-2">
          {/* Search (Desktop) */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </Button>

          {/* Notifications */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setIsNotificationOpen(!isNotificationOpen);
                triggerHapticFeedback('light');
              }}
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 bg-destructive rounded-full" />
              )}
            </Button>

            {/* Notification Dropdown */}
            <AnimatePresence>
              {isNotificationOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 mt-2 w-80 bg-card border rounded-lg shadow-lg overflow-hidden"
                >
                  <div className="p-4 border-b">
                    <h3 className="font-semibold">Notifications</h3>
                    {unreadCount > 0 && (
                      <Badge variant="secondary" size="sm" className="ml-2">
                        {unreadCount} new
                      </Badge>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length > 0 ? (
                      notifications.slice(0, 5).map((notification) => (
                        <div
                          key={notification.id}
                          className={cn(
                            'p-4 border-b hover:bg-accent transition-colors cursor-pointer',
                            !notification.read && 'bg-primary/5'
                          )}
                        >
                          <p className="text-sm font-medium">{notification.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {notification.message}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="p-8 text-center text-muted-foreground">
                        <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No notifications yet</p>
                      </div>
                    )}
                  </div>
                  {notifications.length > 5 && (
                    <Link
                      href="/notifications"
                      className="block p-3 text-center text-sm text-primary hover:bg-accent transition-colors"
                    >
                      View all notifications
                    </Link>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* User Menu */}
          {user ? (
            <div className="hidden md:flex items-center space-x-3 ml-2">
              <div className="text-right">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">Level {user.level}</p>
              </div>
              <Avatar
                src={user.avatar}
                alt={user.name}
                fallback={user.name}
                size="md"
                onClick={() => triggerHapticFeedback('light')}
              />
            </div>
          ) : (
            <div className="hidden md:flex items-center space-x-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">Login</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/register">Sign Up</Link>
              </Button>
            </div>
          )}

          {/* Mobile Menu Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => {
              setIsMobileMenuOpen(!isMobileMenuOpen);
              triggerHapticFeedback('light');
            }}
            aria-label="Menu"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="md:hidden overflow-hidden bg-background border-b"
          >
            <div className="container mx-auto px-4 py-4">
              {/* Mobile Navigation Links */}
              <div className="space-y-2">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      'block px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                      pathname === link.href
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>

              {/* Mobile User Section */}
              {user ? (
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center space-x-3 mb-4">
                    <Avatar src={user.avatar} alt={user.name} fallback={user.name} size="md" />
                    <div>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-sm text-muted-foreground">Level {user.level}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Link
                      href="/profile"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="block px-4 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                    >
                      Profile
                    </Link>
                    <Link
                      href="/settings"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="block px-4 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={() => {
                        useAuthStore.getState().logout();
                        setIsMobileMenuOpen(false);
                      }}
                      className="block w-full text-left px-4 py-2 rounded-lg text-sm text-destructive hover:bg-accent transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t space-y-2">
                  <Button variant="outline" fullWidth asChild>
                    <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>
                      Login
                    </Link>
                  </Button>
                  <Button fullWidth asChild>
                    <Link href="/register" onClick={() => setIsMobileMenuOpen(false)}>
                      Sign Up
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}