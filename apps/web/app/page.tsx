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
                    <Link href="/circles">
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
              <Badge className="mb-4 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/30">AI-Powered</Badge>
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
                  Get Started Free
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

      {/* Pricing Section */}
      <section className="relative py-24">
        <div className="container px-4">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold mb-4 md:text-4xl text-white">
              Choose Your Plan
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Start free and upgrade as you grow
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                name: 'Free',
                price: '$0',
                description: 'Perfect for getting started',
                features: [
                  '1 active challenge',
                  'Basic progress tracking',
                  'Community support',
                  '10 AI coach messages/month'
                ],
                cta: 'Start Free',
                variant: 'outline' as const
              },
              {
                name: 'Pro',
                price: '$9.99',
                period: '/month',
                description: 'For serious fitness enthusiasts',
                features: [
                  'Unlimited challenges',
                  'Advanced analytics',
                  'Unlimited AI coaching',
                  'Priority support',
                  'Custom challenges',
                  'Export data'
                ],
                cta: 'Start Pro Trial',
                variant: 'default' as const,
                popular: true
              },
              {
                name: 'Team',
                price: '$79.99',
                period: '/month',
                description: 'For groups and organizations',
                features: [
                  'Everything in Pro',
                  'Up to 10 team members',
                  'Private team challenges',
                  'Team analytics dashboard',
                  'Custom branding',
                  'Dedicated support'
                ],
                cta: 'Contact Sales',
                variant: 'outline' as const
              }
            ].map((plan, index) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className={`h-full bg-slate-900/50 border-slate-800 backdrop-blur-xl ${plan.popular ? 'border-indigo-500 shadow-2xl shadow-indigo-500/20' : ''}`}>
                  {plan.popular && (
                    <div className="bg-purple-600 text-white text-center py-2 text-sm font-medium">
                      Most Popular
                    </div>
                  )}
                  <CardContent className="p-6">
                    <h3 className="text-2xl font-bold mb-2 text-white">{plan.name}</h3>
                    <div className="mb-4">
                      <span className="text-4xl font-bold text-white">{plan.price}</span>
                      {plan.period && <span className="text-gray-400">{plan.period}</span>}
                    </div>
                    <p className="text-gray-400 mb-6">{plan.description}</p>
                    <ul className="space-y-3 mb-6">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <CheckCircle className="h-5 w-5 text-indigo-400 mt-0.5" />
                          <span className="text-sm text-gray-300">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant={plan.variant}
                      fullWidth
                      className={plan.popular ? 'bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50' : 'border-slate-700 text-gray-300 hover:bg-slate-800'}
                      asChild
                    >
                      <Link href="/register">
                        {plan.cta}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
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