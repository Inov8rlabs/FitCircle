import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      api: 'operational',
      database: 'unknown',
      auth: 'unknown',
    },
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  };

  try {
    // Check database connection
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: dbError } = await supabase
      .from('profiles')
      .select('count')
      .limit(1)
      .single();

    checks.checks.database = dbError ? 'degraded' : 'operational';

    // Check auth service
    const { error: authError } = await supabase.auth.getSession();
    checks.checks.auth = authError ? 'degraded' : 'operational';

    // Determine overall status
    const allOperational = Object.values(checks.checks).every(
      status => status === 'operational'
    );

    checks.status = allOperational ? 'healthy' : 'degraded';

    return NextResponse.json(checks, {
      status: allOperational ? 200 : 503,
    });

  } catch (error) {
    console.error('Health check error:', error);

    return NextResponse.json({
      ...checks,
      status: 'unhealthy',
      error: 'Health check failed',
    }, { status: 503 });
  }
}