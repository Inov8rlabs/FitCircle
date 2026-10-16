import { createServerSupabase } from '@/lib/supabase-server';

/** Cookie-session user for the web referral routes; throws 'Unauthorized' (→ 401 via failFrom). */
export async function requireWebUser(): Promise<{ id: string; email?: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');
  return { id: user.id, email: user.email ?? undefined };
}
