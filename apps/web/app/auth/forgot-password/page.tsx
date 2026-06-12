'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Mail, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LogoIcon } from '@/components/ui/logo';
import { useAuthStore } from '@/stores/auth-store';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get('email') ?? '';
  const { resetPassword } = useAuthStore();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: prefillEmail,
    },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setError(null);
    try {
      await resetPassword(data.email);
    } catch {
      // Intentionally swallow the error: we don't reveal whether an account
      // exists for a given email. Always show the confirmation state.
    } finally {
      setSubmittedEmail(data.email);
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
            <h1 className="text-3xl font-bold text-white">Forgot your password?</h1>
            <p className="text-gray-400 mt-2">
              Enter your email and we&apos;ll send you a reset link
            </p>
          </div>

          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
            <CardContent className="p-6">
              {submittedEmail ? (
                <div className="text-center py-4">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                    <MailCheck className="h-6 w-6 text-emerald-400" />
                  </div>
                  <p className="text-white font-medium">Check your email</p>
                  <p className="text-gray-400 text-sm mt-1">
                    If an account exists for{' '}
                    <span className="text-gray-200">{submittedEmail}</span>, we&apos;ve
                    sent a link to reset your password.
                  </p>
                </div>
              ) : (
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
                    disabled={isSubmitting}
                    loading={isSubmitting}
                    className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all"
                  >
                    Send reset link
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

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
