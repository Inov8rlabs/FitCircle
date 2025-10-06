'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowRight,
  Trophy,
  Users,
  TrendingUp,
  Sparkles,
  CheckCircle,
  Target,
  Zap,
  Shield,
  Smartphone,
  Activity,
  Heart,
  Award,
  BarChart3,
  Calendar,
  MessageSquare,
  Dumbbell
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Logo, LogoIcon } from '@/components/ui/logo';
import { useAuthStore } from '@/stores/auth-store';
import DashboardNav from '@/components/DashboardNav';

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

export default function LandingPage() {
  const { user } = useAuthStore();

  const features = [
    {
      icon: Trophy,
      title: 'Join Challenges',
      description: 'Compete in weight loss and fitness challenges with friends and win prizes',
      color: 'text-yellow-500'
    },
    {
      icon: Users,
      title: 'Team Support',
      description: 'Form teams and motivate each other towards your fitness goals',
      color: 'text-blue-500'
    },
    {
      icon: TrendingUp,
      title: 'Track Progress',
      description: 'Daily check-ins with photos, weight tracking, and detailed analytics',
      color: 'text-green-500'
    },
    {
      icon: Sparkles,
      title: 'AI Coach',
      description: 'Get personalized guidance from Fitzy, your AI-powered fitness coach',
      color: 'text-purple-500'
    },
    {
      icon: Award,
      title: 'Earn Rewards',
      description: 'Level up, unlock achievements, and earn XP as you progress',
      color: 'text-orange-500'
    },
    {
      icon: Shield,
      title: 'Stay Accountable',
      description: 'Build lasting habits with social accountability and team support',
      color: 'text-red-500'
    }
  ];

  const stats: { value: string; label: string }[] = [];

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
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-purple-500/10" />
        <motion.div
          className="container relative px-4 py-24 md:py-32"
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
              <LogoIcon size="lg" />
            </motion.div>

            <motion.h1
              className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl text-white"
              {...fadeIn}
            >
              Welcome to{' '}
              <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">FitCircle</span>
            </motion.h1>

            <motion.p
              className="mb-8 text-lg text-gray-400 sm:text-xl max-w-2xl mx-auto"
              {...fadeIn}
              transition={{ delay: 0.1 }}
            >
              Transform your fitness journey with social challenges, team support, and AI-powered coaching.
              Join thousands achieving their health goals together.
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
                      Explore FitCircles
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button size="lg" className="group bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all" asChild>
                    <Link href="/register">
                      Start Your Journey
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
              Everything You Need to Succeed
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Powerful features designed to help you reach your fitness goals faster
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
                <Card className="h-full bg-slate-900/50 border-slate-800 backdrop-blur-xl hover:shadow-2xl hover:shadow-cyan-500/10 transition-all">
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
              How FitCircle Works
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Get started in minutes and begin your transformation
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                title: 'Create Your Profile',
                description: 'Sign up and set your fitness goals, preferences, and target milestones',
                icon: Users
              },
              {
                step: '2',
                title: 'Join Challenges',
                description: 'Browse and join challenges that match your goals, or create your own',
                icon: Trophy
              },
              {
                step: '3',
                title: 'Track & Win',
                description: 'Check in daily, track progress, and compete with others to win prizes',
                icon: BarChart3
              }
            ].map((item, index) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                className="text-center"
              >
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30">
                  <span className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">{item.step}</span>
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">{item.title}</h3>
                <p className="text-gray-400">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* App Features Section */}
      <section className="relative py-24 bg-slate-950/50">
        <div className="container px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="flex items-center gap-3 mb-4">
                <Badge className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/30">AI-Powered</Badge>
                <Badge className="bg-purple-600 text-white border-purple-500">Coming Soon</Badge>
              </div>
              <h2 className="text-3xl font-bold mb-6 md:text-4xl text-white">
                Meet Fitzy, Your AI Coach
              </h2>
              <p className="text-gray-400 mb-6 text-lg">
                Get personalized workout plans, nutrition advice, and motivation from our intelligent AI coach.
                Fitzy learns from your progress and adapts recommendations to help you achieve your goals faster.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'Personalized workout recommendations',
                  'Nutrition tracking and meal suggestions',
                  '24/7 support and motivation',
                  'Progress analysis and insights',
                  'Adaptive training programs'
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-indigo-400" />
                    <span className="text-gray-300">{item}</span>
                  </li>
                ))}
              </ul>
              <Button size="lg" className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all" asChild>
                <Link href="/register">
                  Join Waitlist
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
                        <h4 className="font-semibold text-white">Fitzy AI Coach</h4>
                        <p className="text-sm text-gray-400">Always here to help</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="bg-slate-800/50 rounded-lg p-3">
                        <p className="text-sm text-gray-300">Your personalized AI coach will provide real-time feedback and recommendations based on your actual progress.</p>
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
              Get FitCircle On The Go
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Track your progress, join challenges, and stay motivated anywhere with our mobile apps
            </p>
          </motion.div>

          <motion.div
            className="flex flex-col sm:flex-row gap-6 justify-center items-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            {/* App Store Button */}
            <div className="relative group">
              <Badge className="absolute -top-3 -right-3 z-10 bg-purple-600 text-white border-purple-500 px-3 py-1 text-xs font-semibold">
                Coming Soon
              </Badge>
              <button
                disabled
                className="relative flex items-center gap-3 bg-slate-900/50 border border-slate-700 rounded-xl px-6 py-4 opacity-60 cursor-not-allowed transition-all"
              >
                <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                <div className="text-left">
                  <div className="text-xs text-gray-400">Download on the</div>
                  <div className="text-lg font-semibold text-white">App Store</div>
                </div>
              </button>
            </div>

            {/* Google Play Button */}
            <div className="relative group">
              <Badge className="absolute -top-3 -right-3 z-10 bg-purple-600 text-white border-purple-500 px-3 py-1 text-xs font-semibold">
                Coming Soon
              </Badge>
              <button
                disabled
                className="relative flex items-center gap-3 bg-slate-900/50 border border-slate-700 rounded-xl px-6 py-4 opacity-60 cursor-not-allowed transition-all"
              >
                <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.5,12.92 20.16,13.19L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
                </svg>
                <div className="text-left">
                  <div className="text-xs text-gray-400">GET IT ON</div>
                  <div className="text-lg font-semibold text-white">Google Play</div>
                </div>
              </button>
            </div>
          </motion.div>

          <motion.div
            className="text-center mt-8"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <p className="text-gray-400 mb-4">
              Get started with FitCircle today and we'll notify you as soon as our mobile apps are ready!
            </p>
            <Button className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all" asChild>
              <Link href="/register">
                Get Started Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
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
                Keep Up the Great Work!
              </h2>
              <p className="text-lg mb-8 text-gray-400 max-w-2xl mx-auto">
                Track your progress, join FitCircles, and stay motivated with your fitness community.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50" asChild>
                  <Link href="/dashboard">
                    View Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white" asChild>
                  <Link href="/circles">
                    Join FitCircles
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-3xl font-bold mb-4 md:text-4xl text-white">
                Ready to Transform Your Life?
              </h2>
              <p className="text-lg mb-8 text-gray-400 max-w-2xl mx-auto">
                Join FitCircle today and start your fitness journey with thousands of motivated individuals just like you.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50" asChild>
                  <Link href="/register">
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white" asChild>
                  <Link href="/demo">
                    Watch Demo
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
                Your social fitness companion for lasting transformation.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-white">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/features" className="hover:text-indigo-400 transition-colors">Features</Link></li>
                <li><Link href="/pricing" className="hover:text-indigo-400 transition-colors">Pricing</Link></li>
                <li><Link href="/demo" className="hover:text-indigo-400 transition-colors">Demo</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-white">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/about" className="hover:text-indigo-400 transition-colors">About</Link></li>
                <li><Link href="/blog" className="hover:text-indigo-400 transition-colors">Blog</Link></li>
                <li><Link href="/careers" className="hover:text-indigo-400 transition-colors">Careers</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-white">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/terms" className="hover:text-indigo-400 transition-colors">Terms</Link></li>
                <li><Link href="/privacy" className="hover:text-indigo-400 transition-colors">Privacy</Link></li>
                <li><Link href="/cookies" className="hover:text-indigo-400 transition-colors">Cookies</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-slate-800 text-center text-sm text-gray-500">
            © 2024 FitCircle. All rights reserved.
          </div>
        </div>
      </footer>
      </div>
    </>
  );
}