import { vi } from 'vitest';
import {
  createMockSupabaseResponse,
  createMockSupabaseError,
} from './test-utils';

// Mock Supabase client builder
export function createMockSupabaseClient(overrides: any = {}) {
  const mockAuth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: null },
      error: null,
    }),
    getSession: vi.fn().mockResolvedValue({
      data: { session: null },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
  };

  const mockFrom = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(createMockSupabaseResponse(null)),
    maybeSingle: vi.fn().mockResolvedValue(createMockSupabaseResponse(null)),
    then: vi.fn((resolve) =>
      resolve(createMockSupabaseResponse([]))
    ),
  }));

  return {
    auth: mockAuth,
    from: mockFrom,
    ...overrides,
  };
}

// Helper to mock authenticated user
export function mockAuthenticatedUser(userId: string = 'test-user-id') {
  const mockUser = {
    id: userId,
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };

  return {
    data: { user: mockUser },
    error: null,
  };
}

// Helper to mock auth error
export function mockAuthError(message: string = 'Unauthorized') {
  return {
    data: { user: null },
    error: createMockSupabaseError(message, 'auth_error'),
  };
}

// Helper to mock successful query
export function mockQuerySuccess<T>(data: T) {
  return createMockSupabaseResponse(data);
}

// Helper to mock query error
export function mockQueryError(message: string = 'Database error') {
  return createMockSupabaseResponse(
    null,
    createMockSupabaseError(message, 'db_error')
  );
}

// Mock implementations for common queries
export const mockSupabaseQueries = {
  // Get user profile
  getUserProfile: (userId: string) => ({
    id: userId,
    email: 'test@example.com',
    username: 'testuser',
    display_name: 'Test User',
    onboarding_completed: true,
  }),

  // Get challenge
  getChallenge: (challengeId: string) => ({
    id: challengeId,
    name: 'Test Challenge',
    challenge_type: 'weight_loss',
    start_date: new Date().toISOString(),
    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    creator_id: 'test-user-id',
    invite_code: 'TEST123',
  }),

  // Get participants
  getParticipants: (challengeId: string) => [
    {
      id: 'participant-1',
      challenge_id: challengeId,
      user_id: 'user-1',
      status: 'active',
      starting_value: 95,
      target_value: 85,
    },
  ],
};
