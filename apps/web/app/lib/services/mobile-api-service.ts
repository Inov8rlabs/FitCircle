import jwt from 'jsonwebtoken';
import { createAdminSupabase } from '../supabase-admin';

// Types for JWT tokens
export interface JWTPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: 'Bearer';
}

export interface DailyTrackingStats {
  todaySteps: number | null;
  todayWeight: number | null;
  weeklyAvgSteps: number;
  currentStreak: number;
}

export interface DailyTrackingWithStats {
  data: any[];
  stats: DailyTrackingStats;
}

export class MobileAPIService {
  // ============================================================================
  // JWT AUTHENTICATION
  // ============================================================================

  /**
   * Generate JWT access and refresh tokens for a user
   */
  static async generateTokens(userId: string, email: string): Promise<TokenPair> {
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!jwtSecret || !jwtRefreshSecret) {
      throw new Error('JWT secrets not configured');
    }

    // Access token (short-lived: 15 minutes)
    const accessTokenExpiry: string = process.env.JWT_ACCESS_TOKEN_EXPIRY || '15m';
    const accessToken = jwt.sign(
      {
        userId,
        email,
        type: 'access',
      },
      jwtSecret,
      { expiresIn: accessTokenExpiry } as jwt.SignOptions
    );

    // Refresh token (long-lived: 7 days)
    const refreshTokenExpiry: string = process.env.JWT_REFRESH_TOKEN_EXPIRY || '7d';
    const refreshToken = jwt.sign(
      {
        userId,
        email,
        type: 'refresh',
      },
      jwtRefreshSecret,
      { expiresIn: refreshTokenExpiry } as jwt.SignOptions
    );

    // Calculate expires_at timestamp (15 minutes from now)
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      token_type: 'Bearer',
    };
  }

  /**
   * Verify and decode an access token
   */
  static async verifyAccessToken(token: string): Promise<JWTPayload | null> {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error('JWT secret not configured');
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

      if (decoded.type !== 'access') {
        return null;
      }

      return decoded;
    } catch (error) {
      // Token is invalid or expired
      return null;
    }
  }

  /**
   * Verify and decode a refresh token
   */
  static async verifyRefreshToken(token: string): Promise<JWTPayload | null> {
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!jwtRefreshSecret) {
      throw new Error('JWT refresh secret not configured');
    }

    try {
      const decoded = jwt.verify(token, jwtRefreshSecret) as JWTPayload;

      if (decoded.type !== 'refresh') {
        return null;
      }

      return decoded;
    } catch (error) {
      // Token is invalid or expired
      return null;
    }
  }

  /**
   * Authenticate user with access token and return user data
   */
  static async authenticateWithToken(accessToken: string): Promise<any | null> {
    console.log('[authenticateWithToken] Verifying access token...');
    const payload = await this.verifyAccessToken(accessToken);

    if (!payload) {
      console.log('[authenticateWithToken] Token verification failed - invalid or expired token');
      return null;
    }

    console.log('[authenticateWithToken] Token verified, userId:', payload.userId);

    // Fetch user from database
    const supabaseAdmin = createAdminSupabase();

    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', payload.userId)
      .single();

    if (error) {
      console.error('[authenticateWithToken] Database error fetching user:', error);
      return null;
    }

    if (!user) {
      console.log('[authenticateWithToken] User not found in database for userId:', payload.userId);
      return null;
    }

    console.log('[authenticateWithToken] User found:', { id: user.id, email: user.email });
    return user;
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(refreshToken: string): Promise<TokenPair | null> {
    const payload = await this.verifyRefreshToken(refreshToken);

    if (!payload) {
      return null;
    }

    // Verify user still exists
    const supabaseAdmin = createAdminSupabase();

    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('id', payload.userId)
      .single();

    if (error || !user) {
      return null;
    }

    // Generate new token pair
    return this.generateTokens(user.id, user.email);
  }

  // ============================================================================
  // DAILY TRACKING
  // ============================================================================

  /**
   * Get daily tracking data with calculated stats
   */
  static async getDailyTrackingWithStats(
    userId: string,
    params: {
      startDate?: string;
      endDate?: string;
      limit?: number;
    }
  ): Promise<DailyTrackingWithStats> {
    const supabaseAdmin = createAdminSupabase();

    let query = supabaseAdmin
      .from('daily_tracking')
      .select('*')
      .eq('user_id', userId)
      .order('tracking_date', { ascending: false });

    if (params.startDate) {
      query = query.gte('tracking_date', params.startDate);
    }

    if (params.endDate) {
      query = query.lte('tracking_date', params.endDate);
    }

    if (params.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Calculate stats
    const stats = await this.calculateDailyTrackingStats(userId, data || []);

    return {
      data: data || [],
      stats,
    };
  }

  /**
   * Calculate daily tracking statistics
   */
  private static async calculateDailyTrackingStats(
    userId: string,
    recentData: any[]
  ): Promise<DailyTrackingStats> {
    const today = new Date().toISOString().split('T')[0];

    // Get today's data
    const todayData = recentData.find((d) => d.tracking_date === today);

    // Calculate weekly average steps
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];

    const weekData = recentData.filter((d) => d.tracking_date >= oneWeekAgoStr && d.steps);
    const weeklyAvgSteps =
      weekData.length > 0
        ? Math.round(weekData.reduce((sum, d) => sum + d.steps, 0) / weekData.length)
        : 0;

    // Calculate current streak
    const streak = this.calculateStreak(recentData);

    return {
      todaySteps: todayData?.steps || null,
      todayWeight: todayData?.weight_kg || null,
      weeklyAvgSteps,
      currentStreak: streak,
    };
  }

  /**
   * Calculate check-in streak
   */
  private static calculateStreak(trackingData: any[]): number {
    if (!trackingData || trackingData.length === 0) return 0;

    // Sort by date descending
    const sorted = [...trackingData].sort(
      (a, b) => new Date(b.tracking_date).getTime() - new Date(a.tracking_date).getTime()
    );

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < sorted.length; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - i);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      const hasEntry = sorted.some((d) => d.tracking_date === targetDateStr);

      if (hasEntry) {
        streak++;
      } else if (i > 0) {
        break; // Streak broken
      }
    }

    return streak;
  }

  /**
   * Create or update daily tracking entry
   */
  static async upsertDailyTracking(
    userId: string,
    trackingDate: string,
    data: {
      weight_kg?: number;
      steps?: number;
      mood_score?: number;
      energy_level?: number;
      notes?: string;
    }
  ): Promise<any> {
    const supabaseAdmin = createAdminSupabase();

    // Check if entry exists for this date
    const { data: existing } = await supabaseAdmin
      .from('daily_tracking')
      .select('id')
      .eq('user_id', userId)
      .eq('tracking_date', trackingDate)
      .single();

    if (existing) {
      // Update existing entry
      const { data: updated, error } = await supabaseAdmin
        .from('daily_tracking')
        .update({
          weight_kg: data.weight_kg,
          steps: data.steps,
          mood_score: data.mood_score,
          energy_level: data.energy_level,
          notes: data.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return updated;
    } else {
      // Insert new entry
      const { data: inserted, error } = await supabaseAdmin
        .from('daily_tracking')
        .insert({
          user_id: userId,
          tracking_date: trackingDate,
          weight_kg: data.weight_kg,
          steps: data.steps,
          mood_score: data.mood_score,
          energy_level: data.energy_level,
          notes: data.notes,
        })
        .select()
        .single();

      if (error) throw error;
      return inserted;
    }
  }

  // ============================================================================
  // PROFILE & STATS
  // ============================================================================

  /**
   * Get user profile with stats and goals
   */
  static async getUserProfileWithStats(userId: string): Promise<any> {
    const supabaseAdmin = createAdminSupabase();

    // Get profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) throw profileError;

    // Get tracking data for stats
    const { data: trackingData } = await supabaseAdmin
      .from('daily_tracking')
      .select('*')
      .eq('user_id', userId)
      .order('tracking_date', { ascending: false })
      .limit(30);

    // Get challenges completed count
    const { count: challengesCompleted } = await supabaseAdmin
      .from('challenge_participants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');

    // Calculate streak
    const currentStreak = this.calculateStreak(trackingData || []);

    return {
      ...profile,
      stats: {
        totalPoints: profile.total_points || 0,
        currentStreak,
        challengesCompleted: challengesCompleted || 0,
      },
      goals: profile.goals || [],
      preferences: profile.preferences || {},
    };
  }

  /**
   * Update user profile
   */
  static async updateUserProfile(
    userId: string,
    updates: {
      display_name?: string;
      username?: string;
      avatar_url?: string;
      bio?: string;
    }
  ): Promise<any> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update user goals
   */
  static async updateUserGoals(userId: string, goals: any[]): Promise<any> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({
        goals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('goals')
      .single();

    if (error) throw error;
    return data;
  }

  // ============================================================================
  // IMAGE UPLOAD TO SUPABASE STORAGE
  // ============================================================================

  /**
   * Upload image to Supabase Storage
   */
  static async uploadImage(
    bucket: string,
    path: string,
    file: Buffer,
    contentType: string
  ): Promise<string> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin.storage.from(bucket).upload(path, file, {
      contentType,
      upsert: true,
    });

    if (error) throw error;

    // Get public URL
    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);

    return publicUrl;
  }

  /**
   * Delete image from Supabase Storage
   */
  static async deleteImage(bucket: string, path: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);

    if (error) throw error;
  }
}
