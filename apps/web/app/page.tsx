'use client';

import { motion } from 'framer-motion';
import {
  ArrowRight,
  Trophy,
  Users,
  Sparkles,
  CheckCircle,
  Camera,
  Flame,
  Dumbbell,
  Crown,
  MessageSquare,
  Mic,
  HeartPulse,
  Shield,
} from 'lucide-react';
import Link from 'next/link';

import DashboardNav from '@/components/DashboardNav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo, LogoIcon } from '@/components/ui/logo';
import { useAuthStore } from '@/stores/auth-store';

// Store links are wired up the moment a listing goes live: set
// NEXT_PUBLIC_APP_STORE_URL / NEXT_PUBLIC_PLAY_STORE_URL on Vercel and the
// buttons switch from "Coming soon" to real download links, no code change.
const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL || '';
const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL || '';

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
};

const stagger = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
};

const features = [
  {
    icon: Camera,
    title: 'Snap a photo, log the meal',
    description:
      'Point your camera at the plate and FitCircle works out calories, protein, carbs and fat. Fix anything it got wrong in a tap, or log by voice or by hand.',
    color: 'text-fuchsia-400'
  },
  {
    icon: Flame,
    title: 'Streaks that survive real life',
    description:
      'A daily check-in keeps your streak alive. Shields cover the days that get away from you, so one missed day never wipes out a month of work.',
    color: 'text-orange-400'
  },
  {
    icon: Users,
    title: 'Your circle, in one chat',
    description:
      'Start a circle with a few friends. Meals, workouts and check-ins post to the chat on their own, so nobody has to ask whether you logged today.',
    color: 'text-indigo-400'
  },
  {
    icon: Dumbbell,
    title: 'Workouts and health sync',
    description:
      'Log a workout in a few taps, or let Apple Health and Health Connect bring in steps, workouts and weight automatically.',
    color: 'text-green-400'
  },
  {
    icon: Sparkles,
    title: 'Fitzy, the coach who knows your logs',
    description:
      'Ask about last week, tonight’s dinner or a stubborn plateau. Fitzy answers from your own food and workout history, not a generic script.',
    color: 'text-purple-400'
  },
  {
    icon: Trophy,
    title: 'Circle challenges',
    description:
      'Weight loss, steps or workout frequency. Pick a challenge template, set the dates, and follow the live leaderboard together.',
    color: 'text-yellow-400'
  }
];

const steps = [
  {
    step: '1',
    title: 'Set your goal',
    description: 'Create an account, tell FitCircle what you’re working toward, and connect Apple Health or Health Connect if you like.',
    icon: HeartPulse
  },
  {
    step: '2',
    title: 'Log your day',
    description: 'Photo your meals, log a workout, and check in once a day to keep the streak going.',
    icon: Camera
  },
  {
    step: '3',
    title: 'Bring your circle',
    description: 'Invite friends with a link or code. React to their wins, get nudged on your slow days, and take on challenges together.',
    icon: MessageSquare
  }
];

const fitzyPoints = [
  'Answers grounded in your own meals and workouts',
  'Meal ideas that fit the macros you have left today',
  'A nudge before a streak slips, not after',
  'Available on the web and in the app'
];

function StoreButton({
  href,
  label,
  eyebrow,
  icon,
  comingSoon,
}: {
  href: string;
  label: string;
  eyebrow: string;
  icon: React.ReactNode;
  comingSoon: boolean;
}) {
  const inner = (
    <>
      {icon}
      <div className="text-left">
        <div className="text-xs text-gray-400">{eyebrow}</div>
        <div className="text-lg font-semibold text-white">{label}</div>
      </div>
    </>
  );
  return (
    <div className="relative">
      {comingSoon && (
        <Badge className="absolute -top-3 -right-3 z-10 bg-purple-600 text-white border-purple-500 px-3 py-1 text-xs font-semibold">
          Coming soon
        </Badge>
      )}
      {comingSoon ? (
        <div
          aria-disabled
          className="flex items-center gap-3 bg-slate-900/50 border border-slate-700 rounded-xl px-6 py-4 opacity-60"
        >
          {inner}
        </div>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 bg-slate-900/70 border border-slate-700 rounded-xl px-6 py-4 hover:border-purple-500 hover:bg-slate-900 transition-colors"
        >
          {inner}
        </a>
      )}
    </div>
  );
}

export default function LandingPage() {
  const { user } = useAuthStore();
  const year = new Date().getFullYear();

  return (
    <>
      {/* Navigation - Conditional based on auth state */}
      {user ? (
        <DashboardNav />
      ) : (
        <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
          <div className="container flex h-16 items-center justify-between">
            <Link href="/">
              <Logo size="md" />
            </Link>
            <div className="flex items-center gap-4">
              <Button variant="ghost" className="text-gray-300 hover:text-white hover:bg-slate-800" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
              <Button className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all" asChild>
                <Link href="/register">Get Started</Link>
              </Button>
            </div>
          </div>
        </nav>
      )}

      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Subtle circle background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-0 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute top-1/3 right-0 w-[700px] h-[700px] bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-3xl" />
          <div className="absolute top-2/3 left-10 w-[400px] h-[400px] bg-green-500/5 rounded-full blur-3xl" />
        </div>

      {/* Hero Section */}
      <section className="relative overflow-clip">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-purple-500/10" />
        <motion.div
          className="container relative px-4 py-20 md:py-28"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <div className="mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="inline-flex items-center gap-2 mb-6"
            >
              <LogoIcon size="xl" />
            </motion.div>

            <motion.h1
              className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl text-white"
              {...fadeIn}
            >
              Log it. Keep the streak.{' '}
              <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">
                Bring your circle.
              </span>
            </motion.h1>

            <motion.p
              className="mb-8 text-lg text-gray-400 sm:text-xl max-w-2xl mx-auto"
              {...fadeIn}
              transition={{ delay: 0.1 }}
            >
              Snap a photo of your meal and FitCircle does the nutrition math. Check in daily to build a
              streak, and share it with a small circle of friends who keep you honest.
            </motion.p>

            <motion.div
              className="flex flex-col sm:flex-row gap-4 justify-center"
              {...fadeIn}
              transition={{ delay: 0.2 }}
            >
              {user ? (
                <>
                  <Button size="lg" className="group bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all" asChild>
                    <Link href="/dashboard">
                      Go to Dashboard
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white" asChild>
                    <Link href="/fitcircles">
                      My FitCircles
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button size="lg" className="group bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all" asChild>
                    <Link href="/register">
                      Start free
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white" asChild>
                    <Link href="/login">
                      Sign In
                    </Link>
                  </Button>
                </>
              )}
            </motion.div>

            <motion.p
              className="mt-6 text-sm text-gray-500"
              {...fadeIn}
              transition={{ delay: 0.3 }}
            >
              Free to start. No credit card. Circles stay free for everyone.
            </motion.p>
          </div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="relative py-24 bg-slate-950/50">
        <div className="container px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold mb-4 md:text-4xl text-white">
              Everything that makes a habit stick
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Fast logging, a streak worth protecting, and people who notice when you show up.
            </p>
          </motion.div>

          <motion.div
            className="grid gap-8 md:grid-cols-2 lg:grid-cols-3"
            variants={stagger}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
          >
            {features.map((feature) => (
              <motion.div key={feature.title} variants={fadeIn}>
                <Card className="h-full bg-slate-900/50 border-slate-800 backdrop-blur-xl hover:shadow-2xl hover:shadow-purple-500/10 transition-all">
                  <CardContent className="p-6">
                    <feature.icon className={`h-12 w-12 mb-4 ${feature.color}`} />
                    <h3 className="text-xl font-semibold mb-2 text-white">{feature.title}</h3>
                    <p className="text-gray-400">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="relative py-24">
        <div className="container px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold mb-4 md:text-4xl text-white">
              How FitCircle works
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Three things, done daily.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((item, index) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                className="text-center"
              >
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30">
                  <item.icon className="h-8 w-8 text-indigo-300" />
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">
                  <span className="text-indigo-400 mr-2">{item.step}.</span>
                  {item.title}
                </h3>
                <p className="text-gray-400">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Fitzy Section */}
      <section className="relative py-24 bg-slate-950/50">
        <div className="container px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="flex items-center gap-3 mb-4">
                <Badge className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/30">AI coach</Badge>
              </div>
              <h2 className="text-3xl font-bold mb-6 md:text-4xl text-white">
                Meet Fitzy, the coach who has read your logs
              </h2>
              <p className="text-gray-400 mb-6 text-lg">
                Every answer starts from what you actually ate and did, so the advice fits your week,
                not an average person&apos;s. Ask in plain language, on the web or in the app.
              </p>
              <ul className="space-y-3 mb-8">
                {fitzyPoints.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-indigo-400" />
                    <span className="text-gray-300">{item}</span>
                  </li>
                ))}
              </ul>
              <Button size="lg" className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all" asChild>
                <Link href={user ? '/dashboard' : '/register'}>
                  {user ? 'Ask Fitzy' : 'Try Fitzy free'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="relative mx-auto max-w-md">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-2xl blur-3xl" />
                <Card className="relative bg-slate-900/50 border-slate-800 backdrop-blur-xl">
                  <CardContent className="p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-white">Fitzy</h4>
                        <p className="text-sm text-gray-400">Knows your last 30 days</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-indigo-600/30 rounded-lg p-3 ml-8">
                        <p className="text-sm text-gray-200">I&apos;m 40g short on protein and it&apos;s 8pm. Ideas?</p>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg p-3 mr-8">
                        <p className="text-sm text-gray-300">
                          You logged Greek yogurt three nights this week and it kept you under your calorie
                          line each time. A bowl with berries gets you 20g. Add two eggs and you&apos;re there,
                          still 150 kcal under goal.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Mobile Apps Section */}
      <section className="relative py-24">
        <div className="container px-4">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold mb-4 md:text-4xl text-white">
              FitCircle in your pocket
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Camera logging, voice logging, Apple Health and Health Connect sync, and push nudges from your circle.
              Everything you log syncs with the web.
            </p>
          </motion.div>

          <motion.div
            className="flex flex-col sm:flex-row gap-6 justify-center items-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <StoreButton
              href={APP_STORE_URL}
              eyebrow="Download on the"
              label="App Store"
              comingSoon={!APP_STORE_URL}
              icon={
                <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
              }
            />
            <StoreButton
              href={PLAY_STORE_URL}
              eyebrow="Get it on"
              label="Google Play"
              comingSoon={!PLAY_STORE_URL}
              icon={
                <svg className="w-10 h-10" viewBox="0 0 24 24" aria-hidden>
                  <path fill="#34A853" d="M3.6 2.4 13.2 12l-9.6 9.6c-.37-.2-.6-.6-.6-1.05V3.45c0-.45.23-.85.6-1.05z" />
                  <path fill="#4285F4" d="M16.4 8.8 13.2 12l-9.6-9.6c.14-.08.3-.13.46-.15L16.4 8.8z" />
                  <path fill="#FBBC04" d="M20.4 10.9c.6.35.6 1.85 0 2.2l-4 2.3-3.2-3.4 3.2-3.2 4 2.1z" />
                  <path fill="#EA4335" d="m16.4 15.4-12.34 6.55c-.16-.02-.32-.07-.46-.15l9.6-9.6 3.2 3.2z" />
                </svg>
              }
            />
          </motion.div>

          {!APP_STORE_URL && (
            <motion.p
              className="text-center mt-8 text-gray-400"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              The iPhone app is in final review. Start on the web today and your account carries straight over.
            </motion.p>
          )}
        </div>
      </section>

      {/* Pro Section */}
      <section className="relative py-20 bg-slate-950/50">
        <div className="container px-4">
          <motion.div
            className="mx-auto max-w-3xl rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-slate-900/40 to-purple-500/10 p-8 md:p-10"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Crown className="h-6 w-6 text-amber-400" />
              <h2 className="text-2xl font-bold text-white md:text-3xl">Free to start. Pro when you want more.</h2>
            </div>
            <p className="text-gray-300 mb-6">
              Every account gets photo logging, streaks, circles, chat and challenges. FitCircle Pro adds unlimited
              AI meal analysis, unlimited Fitzy, your full history, and no ads. Your circles stay free for everyone in them.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold" asChild>
                <Link href="/upgrade">
                  See what Pro includes
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Shield className="h-4 w-4 text-green-400" />
                Cancel any time from your phone or the web
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24 bg-slate-950">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/30 via-slate-950/50 to-indigo-950/30" />
        <motion.div
          className="container px-4 text-center relative"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
        >
          {user ? (
            <>
              <h2 className="text-3xl font-bold mb-4 md:text-4xl text-white">
                Keep the streak going
              </h2>
              <p className="text-lg mb-8 text-gray-400 max-w-2xl mx-auto">
                Log today&apos;s meals, check in, and see what your circle has been up to.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50" asChild>
                  <Link href="/dashboard">
                    Open Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white" asChild>
                  <Link href="/fitcircles">
                    My FitCircles
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-3xl font-bold mb-4 md:text-4xl text-white">
                Start today. Log your first meal in under a minute.
              </h2>
              <p className="text-lg mb-8 text-gray-400 max-w-2xl mx-auto">
                Create a free account, take a photo of your next meal, and invite one friend. That&apos;s day one.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50" asChild>
                  <Link href="/register">
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white" asChild>
                  <Link href="/login">
                    I already have an account
                  </Link>
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-slate-800 py-12 bg-slate-950">
        <div className="container px-4">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4">
                <Logo size="sm" />
              </div>
              <p className="text-gray-400 text-sm">
                Nutrition, streaks and workouts, shared with the people who keep you going.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-white">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/food-log" className="hover:text-indigo-400 transition-colors">Food log</Link></li>
                <li><Link href="/fitcircles" className="hover:text-indigo-400 transition-colors">FitCircles</Link></li>
                <li><Link href="/challenges" className="hover:text-indigo-400 transition-colors">Challenges</Link></li>
                <li><Link href="/upgrade" className="hover:text-indigo-400 transition-colors">FitCircle Pro</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-white">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/support" className="hover:text-indigo-400 transition-colors">Support</Link></li>
                <li><a href="mailto:support@fitcircle.ai" className="hover:text-indigo-400 transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-white">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/terms" className="hover:text-indigo-400 transition-colors">Terms</Link></li>
                <li><Link href="/privacy" className="hover:text-indigo-400 transition-colors">Privacy</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-slate-800 text-center text-sm text-gray-500">
            © {year} Inov8r Labs. FitCircle is a product of Inov8r Labs. All rights reserved.
          </div>
        </div>
      </footer>
      </div>
    </>
  );
}
