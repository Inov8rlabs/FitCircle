import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * CCPA: Right to Opt-Out of Sale/Sharing of Personal Information
 *
 * California residents can opt-out of data sharing with third parties
 * Must honor for at least 12 months before re-requesting
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { optOut } = body;

    if (typeof optOut !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid request: optOut must be boolean' },
        { status: 400 }
      );
    }

    console.log(`CCPA Do Not Sell request: ${user.id} - ${optOut ? 'OPT OUT' : 'OPT IN'}`);

    // Update privacy settings
    const { error: settingsError } = await supabase.from('privacy_settings').upsert({
      user_id: user.id,
      do_not_sell: optOut,
      analytics_enabled: !optOut, // If opt-out, disable analytics
      updated_at: new Date().toISOString(),
    });

    if (settingsError) {
      console.error('Error updating privacy settings:', settingsError);
      return NextResponse.json(
        { error: 'Failed to update settings', details: settingsError.message },
        { status: 500 }
      );
    }

    // Log the preference change for audit trail
    await supabase.from('user_consent').insert({
      user_id: user.id,
      consent_type: 'analytics',
      consent_given: !optOut,
      consent_version: 'ccpa-v1.0',
      consent_text: `CCPA: User ${optOut ? 'opted out of' : 'opted into'} data sharing with third parties`,
      consent_method: 'api',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 12 months
      metadata: {
        ccpa_request: true,
        request_timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      do_not_sell: optOut,
      message: optOut
        ? 'You have opted out of data sharing. Your preference has been saved.'
        : 'You have opted into data sharing. Your preference has been saved.',
    });
  } catch (error) {
    console.error('CCPA opt-out error:', error);
    return NextResponse.json(
      {
        error: 'Failed to update preference',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check current opt-out status
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: settings } = await supabase
      .from('privacy_settings')
      .select('do_not_sell, updated_at')
      .eq('user_id', user.id)
      .single();

    return NextResponse.json({
      do_not_sell: settings?.do_not_sell || false,
      updated_at: settings?.updated_at || null,
    });
  } catch (error) {
    console.error('Error fetching CCPA status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
