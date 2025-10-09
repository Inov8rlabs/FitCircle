import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/fitcircles/[id]/participants/[userId]/remove/route';
import {
  createMockRequest,
  createMockContext,
  createMockChallenge,
} from '../../utils/test-utils';
import {
  createMockSupabaseClient,
  mockAuthenticatedUser,
  mockAuthError,
  mockQuerySuccess,
  mockQueryError,
} from '../../utils/mock-supabase';

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: vi.fn(),
}));

describe('POST /api/fitcircles/[id]/participants/[userId]/remove', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  describe('Authentication', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue(mockAuthError());
      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('POST');
      const context = createMockContext({
        id: 'challenge-id',
        userId: 'participant-id',
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('Authorization', () => {
    it('should return 404 if challenge not found', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser('creator-id')
      );

      const mockFrom = vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(mockQueryError('Not found')),
      }));
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('POST');
      const context = createMockContext({
        id: 'nonexistent-id',
        userId: 'participant-id',
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Challenge not found');
    });

    it('should return 403 if user is not the creator', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser('non-creator-id')
      );

      const mockChallenge = createMockChallenge({
        creator_id: 'original-creator-id',
      });

      const mockFrom = vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
      }));
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('POST');
      const context = createMockContext({
        id: 'challenge-id',
        userId: 'participant-id',
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Only the creator can remove participants');
    });

    it('should return 400 when trying to remove the creator', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const creatorId = 'creator-id';

      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser(creatorId)
      );

      const mockChallenge = createMockChallenge({ creator_id: creatorId });

      const mockFrom = vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
      }));
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('POST');
      const context = createMockContext({
        id: 'challenge-id',
        userId: creatorId, // Trying to remove self (creator)
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Cannot remove the creator');
    });
  });

  describe('Remove Participant', () => {
    it('should successfully remove a participant', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const creatorId = 'creator-id';
      const participantId = 'participant-id';

      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser(creatorId)
      );

      const mockChallenge = createMockChallenge({ creator_id: creatorId });

      let updateCalled = false;
      let capturedStatus: string | undefined;

      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
          };
        }
        if (table === 'challenge_participants') {
          return {
            update: vi.fn((data) => {
              updateCalled = true;
              capturedStatus = data.status;
              return {
                eq: vi.fn().mockReturnThis(),
              };
            }),
            eq: vi.fn().mockReturnThis(),
          };
        }
        return {};
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('POST');
      const context = createMockContext({
        id: 'challenge-id',
        userId: participantId,
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateCalled).toBe(true);
      expect(capturedStatus).toBe('removed');
    });

    it('should handle database errors when removing participant', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const creatorId = 'creator-id';

      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser(creatorId)
      );

      const mockChallenge = createMockChallenge({ creator_id: creatorId });

      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
          };
        }
        if (table === 'challenge_participants') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                error: { message: 'Database error' },
              }),
            }),
          };
        }
        return {};
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('POST');
      const context = createMockContext({
        id: 'challenge-id',
        userId: 'participant-id',
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to remove participant');
    });
  });

  describe('Error Handling', () => {
    it('should handle unexpected errors', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      (createServerSupabase as any).mockRejectedValue(
        new Error('Unexpected error')
      );

      const request = createMockRequest('POST');
      const context = createMockContext({
        id: 'challenge-id',
        userId: 'participant-id',
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });
});
