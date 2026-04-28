'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Loader2, Lock, Mail, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LogoIcon } from '@/components/ui/logo';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  remember: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get('returnUrl');
  const { login, isLoading, error, errorCode, clearError, resendConfirmation } = useAuthStore();
  const { showToast } = useUIStore();
  const [showPassword, setShowPassword] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      remember: true,
    },
  });

  // Reset transient store error when the user starts typing again so the
  // banner doesn't linger after they've already begun retrying.
  useEffect(() => {
    return () => clearError();
  }, [clearError]);

  const onSubmit = async (data: LoginFormData) => {
    try {
      await login(data.email, data.password);
      showToast('Welcome back!', 'success');

      // Redirect to returnUrl if provided, otherwise go to dashboard
      if (returnUrl) {
        router.push(returnUrl);
      } else {
        router.push('/dashboard');
      }
    } catch {
      // Error state lives in the store; clear the password field so the user
      // can retry without manually deleting their last attempt, and refocus
      // the password input.
      setValue('password', '');
      setResendStatus('idle');
      setFocus('password');
    }
  };

  const handleResendConfirmation = async () => {
    const email = getValues('email');
    if (!email) {
      setFocus('email');
      return;
    }
    setResendStatus('sending');
    try {
      await resendConfirmation(email);
    } finally {
      // Always show success — backend / Supabase don't reveal account existence.
      setResendStatus('sent');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Subtle circle background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-0 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-[700px] h-[700px] bg-purple-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center justify-center mb-6">
              <LogoIcon size="lg" />
            </Link>
            <h1 className="text-3xl font-bold text-white">Welcome back</h1>
            <p className="text-gray-400 mt-2">
              Sign in to continue your fitness journey
            </p>
          </div>

          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardContent className="p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Input
                  {...register('email')}
                  type="email"
                  placeholder="Email address"
                  leftIcon={<Mail className="h-4 w-4" />}
                  error={errors.email?.message}
                  autoComplete="email"
                />
              </div>

              <div>
                <Input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  leftIcon={<Lock className="h-4 w-4" />}
                  error={errors.password?.message}
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm"
                >
                  <div className="flex gap-2 text-red-300">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <p className="leading-snug">{error}</p>
                  </div>
                  {errorCode === 'INVALID_CREDENTIALS' && (
                    <div className="mt-2 pl-6">
                      <Link
                        href={
                          getValues('email')
                            ? `/forgot-password?email=${encodeURIComponent(getValues('email'))}`
                            : '/forgot-password'
                        }
                        className="inline-flex items-center text-sm font-medium text-indigo-300 hover:text-indigo-200 hover:underline"
                      >
                        Reset your password
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </div>
                  )}
                  {errorCode === 'EMAIL_NOT_CONFIRMED' && (
                    <div className="mt-2 pl-6">
                      {resendStatus === 'sent' ? (
                        <div className="inline-flex items-center text-sm text-emerald-300">
                          <MailCheck className="mr-1.5 h-3.5 w-3.5" />
                          Confirmation email sent — check your inbox.
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendConfirmation}
                          disabled={resendStatus === 'sending'}
                          className="inline-flex items-center text-sm font-medium text-indigo-300 hover:text-indigo-200 hover:underline disabled:opacity-60"
                        >
                          {resendStatus === 'sending' ? (
                            <>
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              Sending…
                            </>
                          ) : (
                            <>
                              Resend confirmation email
                              <ArrowRight className="ml-1 h-3.5 w-3.5" />
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-2 text-sm">
                  <input
                    {...register('remember')}
                    type="checkbox"
                    className="rounded border-slate-700 text-indigo-500 focus:ring-indigo-500 bg-slate-900"
                  />
                  <span className="text-gray-300">Remember me</span>
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-indigo-400 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                fullWidth
                size="lg"
                disabled={isSubmitting || isLoading}
                loading={isSubmitting || isLoading}
                className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all"
              >
                Sign In
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-gray-400">Don&apos;t have an account? </span>
              <Link
                href={returnUrl ? `/register?returnUrl=${encodeURIComponent(returnUrl)}` : '/register'}
                className="text-indigo-400 hover:underline font-medium"
              >
                Sign up
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-gray-500 mt-6">
          By signing in, you agree to our{' '}
          <Link href="/terms" className="underline hover:text-white text-indigo-400">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-white text-indigo-400">
            Privacy Policy
          </Link>
        </p>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}