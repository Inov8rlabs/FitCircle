import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({
        hasSubscription: false,
        message: 'User not authenticated'
      }, { status: 401 });
    }

    // Check user's subscription status from profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_status, subscription_expires_at')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return NextResponse.json({
        hasSubscription: false,
        message: 'Could not fetch subscription status'
      });
    }

    // Determine if user has active subscription
    const hasActiveSubscription =
      profile?.subscription_tier !== 'free' &&
      profile?.subscription_status === 'active' &&
      (!profile?.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

    return NextResponse.json({
      hasSubscription: hasActiveSubscription,
      tier: profile?.subscription_tier || 'free',
      status: profile?.subscription_status || 'inactive',
      expiresAt: profile?.subscription_expires_at || null
    });

  } catch (error) {
    console.error('Error checking subscription:', error);
    return NextResponse.json({
      hasSubscription: false,
      message: 'Internal server error'
    }, { status: 500 });
  }
}