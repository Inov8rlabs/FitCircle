'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Mail,
  Lock,
  User,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  Trophy,
  Users,
  TrendingUp,
  Check,
  Github,
  Chrome
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Logo, LogoIcon } from '@/components/ui/logo';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';

const registerSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
});

type RegisterFormData = z.infer<typeof registerSchema>;

const benefits = [
  { icon: Trophy, text: 'Join fitness challenges' },
  { icon: Users, text: 'Connect with community' },
  { icon: TrendingUp, text: 'Track your progress' },
  { icon: Sparkles, text: 'AI-powered coaching' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser, isLoading } = useAuthStore();
  const { showToast } = useUIStore();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const password = watch('password', '');

  const onSubmit = async (data: RegisterFormData) => {
    try {
      await registerUser({
        email: data.email,
        password: data.password,
        name: data.name,
        username: data.email.split('@')[0], // Generate username from email
      });
      showToast('Account created successfully!', 'success');
      router.push('/onboarding');
    } catch (error) {
      showToast('Registration failed. Please try again.', 'error');
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Subtle circle background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-0 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-[700px] h-[700px] bg-purple-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-3xl" />
      </div>

      {/* Left Side - Form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md space-y-8"
        >
          {/* Logo */}
          <div className="text-center">
            <Link href="/" className="inline-flex items-center justify-center mb-8">
              <LogoIcon size="lg" />
            </Link>

            <h1 className="text-3xl font-bold tracking-tight text-white">
              Welcome to <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-orange-400 bg-clip-text text-transparent">FitCircle</span>
            </h1>
            <p className="mt-2 text-gray-400">
              Join thousands achieving their fitness goals together
            </p>
          </div>

          {/* Social Login Buttons */}
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              fullWidth
              size="lg"
              className="bg-slate-900/50 border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white"
            >
              <Chrome className="w-5 h-5 mr-2" />
              Continue with Google
            </Button>

            <Button
              type="button"
              variant="outline"
              fullWidth
              size="lg"
              className="bg-slate-900/50 border-slate-700 text-gray-300 hover:bg-slate-800 hover:text-white"
            >
              <Github className="w-5 h-5 mr-2" />
              Continue with GitHub
            </Button>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-slate-950 text-gray-400">Or register with email</span>
            </div>
          </div>

          {/* Registration Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-2 text-gray-300">
                  Full Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    {...register('name')}
                    type="text"
                    className="block w-full pl-10 pr-3 py-3 border border-slate-700 rounded-lg bg-slate-900/50 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    placeholder="John Doe"
                  />
                </div>
                {errors.name && (
                  <p className="mt-1 text-sm text-red-500">{errors.name.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2 text-gray-300">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    {...register('email')}
                    type="email"
                    className="block w-full pl-10 pr-3 py-3 border border-slate-700 rounded-lg bg-slate-900/50 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    placeholder="john@example.com"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-sm text-red-500">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium mb-2 text-gray-300">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    className="block w-full pl-10 pr-10 py-3 border border-slate-700 rounded-lg bg-slate-900/50 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-gray-500 hover:text-white transition-colors" />
                    ) : (
                      <Eye className="h-5 w-5 text-gray-500 hover:text-white transition-colors" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>
                )}

                {/* Password requirements */}
                <div className="mt-2 space-y-1">
                  <div className="flex items-center text-xs">
                    <Check className={`w-3 h-3 mr-2 ${password?.length >= 8 ? 'text-green-400' : 'text-gray-500'}`} />
                    <span className={password?.length >= 8 ? 'text-green-400' : 'text-gray-500'}>
                      At least 8 characters
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Terms */}
            <div className="flex items-start">
              <input
                id="terms"
                type="checkbox"
                className="mt-0.5 rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 bg-slate-900"
                required
              />
              <label htmlFor="terms" className="ml-2 text-sm text-gray-400">
                I agree to the{' '}
                <Link href="/terms" className="text-indigo-400 hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="text-indigo-400 hover:underline">
                  Privacy Policy
                </Link>
              </label>
            </div>

            <Button
              type="submit"
              fullWidth
              size="lg"
              disabled={isSubmitting || isLoading}
              loading={isSubmitting || isLoading}
              className="group bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all"
            >
              Create Account
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </form>

          {/* Sign In Link */}
          <div className="text-center">
            <span className="text-sm text-gray-400">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-indigo-400 hover:underline">
                Sign in
              </Link>
            </span>
          </div>
        </motion.div>
      </div>

      {/* Right Side - Hero Image/Benefits */}
      <div className="hidden lg:flex lg:flex-1 relative z-10">
        <div className="flex-1 flex items-center justify-center px-12">
          <div className="max-w-lg">
            <h2 className="text-4xl font-bold mb-6 text-white">
              Start Your Fitness Journey Today
            </h2>

            <div className="space-y-4 mb-8">
              {benefits.map((benefit, index) => {
                const colors = [
                  { bg: 'bg-indigo-500/20', icon: 'text-indigo-400' },
                  { bg: 'bg-purple-500/20', icon: 'text-purple-400' },
                  { bg: 'bg-orange-500/20', icon: 'text-orange-400' },
                  { bg: 'bg-green-500/20', icon: 'text-green-400' },
                ];
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center"
                  >
                    <div className={`w-10 h-10 rounded-full ${colors[index].bg} flex items-center justify-center mr-4`}>
                      <benefit.icon className={`w-5 h-5 ${colors[index].icon}`} />
                    </div>
                    <span className="text-lg text-gray-300">{benefit.text}</span>
                  </motion.div>
                );
              })}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}