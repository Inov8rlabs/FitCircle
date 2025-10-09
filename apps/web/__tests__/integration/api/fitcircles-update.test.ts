import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PATCH } from '@/app/api/fitcircles/[id]/update/route';
import {
  createMockRequest,
  createMockContext,
  createMockUser,
  createMockChallenge,
} from '../../utils/test-utils';
import {
  createMockSupabaseClient,
  mockAuthenticatedUser,
  mockAuthError,
  mockQuerySuccess,
  mockQueryError,
} from '../../utils/mock-supabase';

// Mock the Supabase server module
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: vi.fn(),
}));

describe('PATCH /api/fitcircles/[id]/update', () => {
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

      const request = createMockRequest('PATCH', {
        name: 'Updated Challenge',
      });
      const context = createMockContext({ id: 'challenge-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 if auth check fails', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });
      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('PATCH', { name: 'Test' });
      const context = createMockContext({ id: 'challenge-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('Authorization', () => {
    it('should return 404 if challenge not found', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser('user-id')
      );

      // Mock challenge fetch returning null
      const mockFrom = vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(mockQueryError('Not found')),
      }));
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('PATCH', { name: 'Test' });
      const context = createMockContext({ id: 'nonexistent-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Challenge not found');
    });

    it('should return 403 if user is not the creator', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser('different-user-id')
      );

      // Mock challenge owned by different user
      const mockChallenge = createMockChallenge({
        creator_id: 'original-creator-id',
      });

      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue(mockQuerySuccess(mockChallenge)),
            update: vi.fn().mockReturnThis(),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        };
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('PATCH', { name: 'Hacked' });
      const context = createMockContext({ id: 'challenge-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Only the creator can update this challenge');
    });
  });

  describe('Update Operations', () => {
    beforeEach(() => {
      const { createServerSupabase } = import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser('creator-id')
      );
    });

    it('should successfully update challenge name', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const mockChallenge = createMockChallenge({ creator_id: 'creator-id' });
      const updatedChallenge = { ...mockChallenge, name: 'Updated Name' };

      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValueOnce(mockQuerySuccess(mockChallenge)),
            update: vi.fn().mockReturnThis(),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(mockQuerySuccess(updatedChallenge)),
        };
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('PATCH', { name: 'Updated Name' });
      const context = createMockContext({ id: 'challenge-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should normalize start_date to noon UTC', async () => {
      // This test verifies the timezone bug fix
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const mockChallenge = createMockChallenge({ creator_id: 'creator-id' });

      let capturedUpdate: any;
      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
            update: vi.fn((updates) => {
              capturedUpdate = updates;
              return {
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue(mockQuerySuccess({ ...mockChallenge, ...updates })),
              };
            }),
          };
        }
        return {};
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('PATCH', {
        start_date: '2025-09-01', // User inputs Sept 1
      });
      const context = createMockContext({ id: 'challenge-id' });

      await PATCH(request, context);

      // Verify the date is normalized to noon UTC
      expect(capturedUpdate.start_date).toBe('2025-09-01T12:00:00Z');
      // Verify registration_deadline is also updated
      expect(capturedUpdate.registration_deadline).toBe('2025-09-01T12:00:00Z');
    });

    it('should validate start_date is before end_date', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const mockChallenge = createMockChallenge({
        creator_id: 'creator-id',
        start_date: '2025-01-01T12:00:00Z',
        end_date: '2025-01-31T12:00:00Z',
      });

      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
          };
        }
        return {};
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('PATCH', {
        start_date: '2025-02-01', // After end date
        end_date: '2025-01-31',
      });
      const context = createMockContext({ id: 'challenge-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Start date must be before end date');
    });

    it('should handle partial updates correctly', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const mockChallenge = createMockChallenge({ creator_id: 'creator-id' });

      let capturedUpdate: any;
      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
            update: vi.fn((updates) => {
              capturedUpdate = updates;
              return {
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue(mockQuerySuccess({ ...mockChallenge, ...updates })),
              };
            }),
          };
        }
        return {};
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      // Only update name, not dates
      const request = createMockRequest('PATCH', { name: 'New Name Only' });
      const context = createMockContext({ id: 'challenge-id' });

      await PATCH(request, context);

      // Verify only name was in the update
      expect(capturedUpdate.name).toBe('New Name Only');
      expect(capturedUpdate.start_date).toBeUndefined();
      expect(capturedUpdate.end_date).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle database update errors', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      mockSupabase.auth.getUser.mockResolvedValue(
        mockAuthenticatedUser('creator-id')
      );

      const mockChallenge = createMockChallenge({ creator_id: 'creator-id' });

      const mockFrom = vi.fn((table: string) => {
        if (table === 'challenges') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue(mockQuerySuccess(mockChallenge)),
            update: vi.fn().mockReturnThis(),
          };
        }
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(mockQueryError('Database error')),
        };
      });
      mockSupabase.from = mockFrom;

      (createServerSupabase as any).mockResolvedValue(mockSupabase);

      const request = createMockRequest('PATCH', { name: 'Test' });
      const context = createMockContext({ id: 'challenge-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to update challenge');
    });

    it('should handle unexpected errors gracefully', async () => {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      (createServerSupabase as any).mockRejectedValue(
        new Error('Unexpected error')
      );

      const request = createMockRequest('PATCH', { name: 'Test' });
      const context = createMockContext({ id: 'challenge-id' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });
});
