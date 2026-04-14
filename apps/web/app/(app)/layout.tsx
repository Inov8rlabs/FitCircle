'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { BottomNav } from '@/components/layout/bottom-nav';
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

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    // Hide bottom nav on certain pages
    const hideBottomNavPaths = ['/checkin', '/coach', '/onboarding'];
    setBottomNavVisible(!hideBottomNavPaths.includes(pathname));
  }, [pathname, setBottomNavVisible]);

  // Redirect to login if not authenticated
  useEffect(() => {
    const publicPaths = ['/', '/login', '/register', '/forgot-password'];
    if (!isAuthenticated && !publicPaths.includes(pathname)) {
      void router.push('/login');
    }
  }, [isAuthenticated, pathname, router]);

  return (
    <div className="min-h-screen bg-background">
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
      <BottomNav />
    </div>
  );
}