import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

const createTeamSchema = z.object({
  challenge_id: z.string().uuid(),
  name: z.string().min(2).max(50),
  motto: z.string().max(200).optional(),
  avatar_url: z.string().url().optional(),
  is_public: z.boolean().optional(),
  max_members: z.number().min(2).max(100).optional(),
});

const teamFiltersSchema = z.object({
  challenge_id: z.string().uuid().optional(),
  search: z.string().optional(),
  is_public: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
});

// GET /api/teams - Get teams with filters
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse filters
    const filters = teamFiltersSchema.parse({
      challenge_id: searchParams.get('challenge_id') || undefined,
      search: searchParams.get('search') || undefined,
      is_public: searchParams.get('is_public') === 'true' ? true :
                 searchParams.get('is_public') === 'false' ? false : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    });

    const db = new DatabaseService();

    // Build query
    let query = db.client.from('teams').select(`
      *,
      challenge:challenges!challenge_id(id, name, type, status),
      members:team_members(
        id, user_id, role, joined_at, points_contributed,
        user:profiles!user_id(id, username, display_name, avatar_url)
      )
    `);

    if (filters.challenge_id) {
      query = query.eq('challenge_id', filters.challenge_id);
    }

    if (filters.is_public !== undefined) {
      query = query.eq('is_public', filters.is_public);
    }

    if (filters.search) {
      query = query.ilike('name', `%${filters.search}%`);
    }

    // Apply pagination
    query = query
      .range(filters.offset, filters.offset + filters.limit - 1)
      .order('total_points', { ascending: false });

    const { data: teams, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to fetch teams', error.code, 500, error);
    }

    // Get user's team memberships if authenticated
    const cookieStore = cookies();
    const token = cookieStore.get('sb-access-token')?.value;
    let userTeams = [];

    if (token) {
      const { getAuthUser } = await import('@fitcircle/database/client');
      const user = await getAuthUser(token);

      if (user) {
        const { data: memberships } = await db.client
          .from('team_members')
          .select('team_id, role')
          .eq('user_id', user.id);

        userTeams = memberships || [];
      }
    }

    // Enhance teams with user membership status
    const enhancedTeams = teams.map(team => ({
      ...team,
      isJoined: userTeams.some(t => t.team_id === team.id),
      userRole: userTeams.find(t => t.team_id === team.id)?.role,
    }));

    return NextResponse.json({
      teams: enhancedTeams,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: teams.length,
      }
    });

  } catch (error) {
    console.error('GET teams error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch teams' },
      { status: 500 }
    );
  }
}

// POST /api/teams - Create a new team
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const cookieStore = cookies();
    const token = cookieStore.get('sb-access-token')?.value;

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { getAuthUser } = await import('@fitcircle/database/client');
    const user = await getAuthUser(token);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = createTeamSchema.parse(body);

    const db = new DatabaseService();

    // Verify challenge exists and is open for team creation
    const challenge = await db.getChallenge(validatedData.challenge_id);

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found' },
        { status: 404 }
      );
    }

    if (challenge.status !== 'upcoming' && challenge.status !== 'active') {
      return NextResponse.json(
        { error: 'Challenge is not accepting new teams' },
        { status: 400 }
      );
    }

    // Check if user is already in a team for this challenge
    const { data: existingMembership } = await db.client
      .from('team_members')
      .select(`
        id,
        team:teams!team_id(id, challenge_id)
      `)
      .eq('user_id', user.id);

    const hasTeamInChallenge = existingMembership?.some(
      m => m.team?.challenge_id === validatedData.challenge_id
    );

    if (hasTeamInChallenge) {
      return NextResponse.json(
        { error: 'You are already in a team for this challenge' },
        { status: 400 }
      );
    }

    // Check if team name is unique for this challenge
    const { data: existingTeam } = await db.client
      .from('teams')
      .select('id')
      .eq('challenge_id', validatedData.challenge_id)
      .eq('name', validatedData.name)
      .single();

    if (existingTeam) {
      return NextResponse.json(
        { error: 'Team name already exists in this challenge' },
        { status: 400 }
      );
    }

    // Create team
    const { data: team, error: teamError } = await db.client
      .from('teams')
      .insert({
        ...validatedData,
        member_count: 1,
        total_points: 0,
      })
      .select()
      .single();

    if (teamError) {
      throw new DatabaseError('Failed to create team', teamError.code, 500, teamError);
    }

    // Add creator as captain
    const { error: memberError } = await db.client
      .from('team_members')
      .insert({
        team_id: team.id,
        user_id: user.id,
        role: 'captain',
        joined_at: new Date().toISOString(),
        is_active: true,
      });

    if (memberError) {
      // Rollback team creation
      await db.client.from('teams').delete().eq('id', team.id);
      throw new DatabaseError('Failed to add team captain', memberError.code, 500, memberError);
    }

    // Update user's challenge participation with team
    await db.client
      .from('challenge_participants')
      .update({
        team_id: team.id,
        updated_at: new Date().toISOString(),
      })
      .eq('challenge_id', validatedData.challenge_id)
      .eq('user_id', user.id);

    // Create notification
    await db.createNotification({
      user_id: user.id,
      type: 'team_invite',
      channel: 'in_app',
      title: 'Team Created!',
      body: `Your team "${team.name}" has been created. Invite members to join!`,
      related_team_id: team.id,
      related_challenge_id: validatedData.challenge_id,
      action_url: `/teams/${team.id}`,
    });

    // Fetch complete team data
    const { data: completeTeam } = await db.client
      .from('teams')
      .select(`
        *,
        challenge:challenges!challenge_id(id, name, type),
        members:team_members(
          id, user_id, role,
          user:profiles!user_id(id, username, display_name, avatar_url)
        )
      `)
      .eq('id', team.id)
      .single();

    return NextResponse.json({
      team: completeTeam,
      message: 'Team created successfully!',
    }, { status: 201 });

  } catch (error) {
    console.error('POST team error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create team' },
      { status: 500 }
    );
  }
}