'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, CheckCircle2, Lock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LogoIcon } from '@/components/ui/logo';
import { supabase } from '@/lib/supabase';
import { useUIStore } from '@/stores/ui-store';

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const { showToast } = useUIStore();
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  // When the user arrives from the password-reset email, Supabase JS parses the
  // URL fragment and establishes a recovery session, emitting a
  // PASSWORD_RECOVERY auth event. We also check for an already-established
  // session in case the event fired before this component mounted.
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && session) {
        setHasRecoverySession(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasRecoverySession(true);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (data: ResetPasswordFormData) => {
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: data.password,
      });

      if (updateError) throw updateError;

      setSuccess(true);
      showToast('Password updated successfully!', 'success');

      // Give the user a moment to read the confirmation, then send them to login.
      setTimeout(() => {
        router.push('/login');
      }, 1500);
    } catch (err: any) {
      setError(
        err?.message ||
          'Could not update your password. The reset link may have expired — please request a new one.'
      );
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
            <h1 className="text-3xl font-bold text-white">Set a new password</h1>
            <p className="text-gray-400 mt-2">Choose a new password for your account</p>
          </div>

          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardContent className="p-6">
              {success ? (
                <div className="text-center py-4">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  </div>
                  <p className="text-white font-medium">Password updated</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Redirecting you to sign in…
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  {!hasRecoverySession && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"
                    >
                      <div className="flex gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <p className="leading-snug">
                          Open this page from the link in your password-reset
                          email. If you arrived here directly, the link may have
                          expired —{' '}
                          <Link
                            href="/auth/forgot-password"
                            className="font-medium text-indigo-300 hover:text-indigo-200 hover:underline"
                          >
                            request a new one
                          </Link>
                          .
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <Input
                      {...register('password')}
                      type="password"
                      placeholder="New password"
                      leftIcon={<Lock className="h-4 w-4" />}
                      error={errors.password?.message}
                      autoComplete="new-password"
                    />
                  </div>

                  <div>
                    <Input
                      {...register('confirmPassword')}
                      type="password"
                      placeholder="Confirm new password"
                      leftIcon={<Lock className="h-4 w-4" />}
                      error={errors.confirmPassword?.message}
                      autoComplete="new-password"
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
                    </div>
                  )}

                  <Button
                    type="submit"
                    fullWidth
                    size="lg"
                    disabled={isSubmitting || !hasRecoverySession}
                    loading={isSubmitting}
                    className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all"
                  >
                    Update password
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
              )}

              <div className="mt-6 text-center text-sm">
                <Link href="/login" className="text-indigo-400 hover:underline font-medium">
                  Back to sign in
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
