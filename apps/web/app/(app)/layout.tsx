'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Navbar } from '@/components/layout/navbar';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';


export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, checkAuth } = useAuthStore();
  const { setBottomNavVisible } = useUIStore();
  // The server already gated this request (middleware + the page's own
  // getUser()). The client store starts out signed-out until checkAuth() has
  // read the Supabase session, so redirecting before that finished bounced
  // every direct load of /food-log and /body-composition to /login.
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkAuth().finally(() => {
      if (!cancelled) setAuthChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [checkAuth]);

  useEffect(() => {
    // Hide bottom nav on certain pages
    const hideBottomNavPaths = ['/checkin', '/coach', '/onboarding'];
    setBottomNavVisible(!hideBottomNavPaths.includes(pathname));
  }, [pathname, setBottomNavVisible]);

  // Session gone (signed out in another tab, expired): send to login, but
  // only once the session check has actually finished.
  useEffect(() => {
    if (!authChecked || isAuthenticated) return;
    const publicPaths = ['/', '/login', '/register', '/forgot-password'];
    if (!publicPaths.includes(pathname)) {
      void router.replace(`/login?returnUrl=${encodeURIComponent(pathname)}`);
    }
  }, [authChecked, isAuthenticated, pathname, router]);

  return (
    <div className="min-h-screen bg-canvas">
      <Navbar />
      <AnimatePresence mode="wait">
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="pb-20 md:pb-0"
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}