import { NextResponse } from 'next/server';

/**
 * POST /api/fitcircles/join — retired.
 *
 * It joined any circle by id with no invite or visibility check. Joins go
 * through POST /api/mobile/circles/join (invite code) or
 * POST /api/mobile/circles/{id}/join (public circles / invite code), which
 * enforce invite, visibility, capacity and late-join rules. No shipped client
 * calls this route.
 */
export function POST() {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: {
        code: 'ENDPOINT_RETIRED',
        message: 'Join with an invite code via /api/mobile/circles/join',
        details: {},
        timestamp: new Date().toISOString(),
      },
      meta: null,
    },
    { status: 410 }
  );
}
