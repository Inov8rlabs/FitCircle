import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Server-side Supabase client with service role key
export function createServerClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

// Browser-side Supabase client with anon key
export function createBrowserClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Helper to get authenticated user from request cookies
export async function getAuthUser(accessToken: string) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return user;
}

// Error handling utility
export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// Common database operations wrapper
export class DatabaseService {
  private client: ReturnType<typeof createServerClient>;

  constructor() {
    this.client = createServerClient();
  }

  // Profile operations
  async getProfile(userId: string) {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw new DatabaseError('Failed to fetch profile', error.code, 500, error);
    }

    return data;
  }

  async updateProfile(userId: string, updates: any) {
    const { data, error } = await this.client
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to update profile', error.code, 500, error);
    }

    return data;
  }

  // Challenge operations
  async getChallenges(filters?: {
    status?: string;
    visibility?: string;
    creator_id?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = this.client.from('challenges').select(`
      *,
      creator:profiles!creator_id(id, username, display_name, avatar_url),
      participant_count
    `);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.visibility) {
      query = query.eq('visibility', filters.visibility);
    }
    if (filters?.creator_id) {
      query = query.eq('creator_id', filters.creator_id);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 10) - 1);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to fetch challenges', error.code, 500, error);
    }

    return data;
  }

  async getChallenge(challengeId: string) {
    const { data, error } = await this.client
      .from('challenges')
      .select(`
        *,
        creator:profiles!creator_id(id, username, display_name, avatar_url),
        participants:challenge_participants(
          id, user_id, team_id, status, total_points, rank,
          user:profiles!user_id(id, username, display_name, avatar_url)
        ),
        teams(id, name, avatar_url, member_count, total_points, rank)
      `)
      .eq('id', challengeId)
      .single();

    if (error) {
      throw new DatabaseError('Failed to fetch challenge', error.code, 500, error);
    }

    return data;
  }

  async createChallenge(challenge: any) {
    const { data, error } = await this.client
      .from('challenges')
      .insert(challenge)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to create challenge', error.code, 500, error);
    }

    return data;
  }

  async updateChallenge(challengeId: string, updates: any) {
    const { data, error } = await this.client
      .from('challenges')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', challengeId)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to update challenge', error.code, 500, error);
    }

    return data;
  }

  async joinChallenge(challengeId: string, userId: string, teamId?: string) {
    const { data, error } = await this.client
      .from('challenge_participants')
      .insert({
        challenge_id: challengeId,
        user_id: userId,
        team_id: teamId,
        status: 'active',
        joined_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to join challenge', error.code, 500, error);
    }

    // Update participant count
    await this.client.rpc('increment_participant_count', { challenge_id: challengeId });

    return data;
  }

  // Team operations
  async getTeams(challengeId?: string) {
    let query = this.client.from('teams').select(`
      *,
      challenge:challenges!challenge_id(id, name, type),
      members:team_members(
        id, user_id, role,
        user:profiles!user_id(id, username, display_name, avatar_url)
      )
    `);

    if (challengeId) {
      query = query.eq('challenge_id', challengeId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to fetch teams', error.code, 500, error);
    }

    return data;
  }

  async createTeam(team: any) {
    const { data, error } = await this.client
      .from('teams')
      .insert(team)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to create team', error.code, 500, error);
    }

    // Add creator as captain
    await this.client.from('team_members').insert({
      team_id: data.id,
      user_id: team.captain_id,
      role: 'captain',
      joined_at: new Date().toISOString()
    });

    return data;
  }

  async joinTeam(teamId: string, userId: string) {
    const { data, error } = await this.client
      .from('team_members')
      .insert({
        team_id: teamId,
        user_id: userId,
        role: 'member',
        joined_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to join team', error.code, 500, error);
    }

    // Update member count
    await this.client.rpc('increment_team_member_count', { team_id: teamId });

    return data;
  }

  // Check-in operations
  async createCheckIn(checkIn: any) {
    const { data, error } = await this.client
      .from('check_ins')
      .insert(checkIn)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to create check-in', error.code, 500, error);
    }

    // Update participant stats
    await this.client.rpc('update_participant_stats', {
      participant_id: checkIn.participant_id,
      check_in_date: checkIn.check_in_date
    });

    return data;
  }

  async getCheckIns(filters: {
    user_id?: string;
    challenge_id?: string;
    team_id?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = this.client.from('check_ins').select(`
      *,
      user:profiles!user_id(id, username, display_name, avatar_url),
      challenge:challenges!challenge_id(id, name, type)
    `);

    if (filters.user_id) {
      query = query.eq('user_id', filters.user_id);
    }
    if (filters.challenge_id) {
      query = query.eq('challenge_id', filters.challenge_id);
    }
    if (filters.team_id) {
      query = query.eq('team_id', filters.team_id);
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    if (filters.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 10) - 1);
    }

    const { data, error } = await query.order('check_in_date', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to fetch check-ins', error.code, 500, error);
    }

    return data;
  }

  // Leaderboard operations
  async getLeaderboard(challengeId: string, entityType: 'individual' | 'team' = 'individual') {
    const { data, error } = await this.client
      .from('leaderboard')
      .select(`
        *,
        entity:${entityType === 'individual' ? 'profiles' : 'teams'}!entity_id(
          ${entityType === 'individual'
            ? 'id, username, display_name, avatar_url'
            : 'id, name, avatar_url, member_count'}
        )
      `)
      .eq('challenge_id', challengeId)
      .eq('entity_type', entityType)
      .order('rank', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to fetch leaderboard', error.code, 500, error);
    }

    return data;
  }

  // Notification operations
  async createNotification(notification: any) {
    const { data, error } = await this.client
      .from('notifications')
      .insert(notification)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to create notification', error.code, 500, error);
    }

    return data;
  }

  async getNotifications(userId: string, unreadOnly = false) {
    let query = this.client
      .from('notifications')
      .select('*')
      .eq('user_id', userId);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to fetch notifications', error.code, 500, error);
    }

    return data;
  }

  async markNotificationRead(notificationId: string) {
    const { error } = await this.client
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', notificationId);

    if (error) {
      throw new DatabaseError('Failed to mark notification as read', error.code, 500, error);
    }
  }
}