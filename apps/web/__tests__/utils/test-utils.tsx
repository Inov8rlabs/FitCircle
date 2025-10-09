import { render, RenderOptions } from '@testing-library/react';
import { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';

// Mock wrapper for providers if needed
function AllTheProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// Custom render with providers
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllTheProviders, ...options });
}

// Re-export everything from testing library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

// Mock request helpers for API route testing
export function createMockRequest(
  method: string,
  body?: any,
  headers?: Record<string, string>
): Request {
  const url = 'http://localhost:3000/api/test';

  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function createMockContext(params: Record<string, string>) {
  return {
    params: Promise.resolve(params),
  };
}

// Mock Supabase response helpers
export function createMockSupabaseResponse<T>(data: T, error: any = null) {
  return {
    data,
    error,
    count: null,
    status: error ? 400 : 200,
    statusText: error ? 'Bad Request' : 'OK',
  };
}

export function createMockSupabaseError(message: string, code?: string) {
  return {
    message,
    code: code || 'error',
    details: null,
    hint: null,
  };
}

// Helper to create mock authenticated user
export function createMockUser(overrides: Partial<any> = {}) {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create mock profile
export function createMockProfile(overrides: Partial<any> = {}) {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    username: 'testuser',
    display_name: 'Test User',
    onboarding_completed: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create mock challenge
export function createMockChallenge(overrides: Partial<any> = {}) {
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 30);

  return {
    id: 'test-challenge-id',
    name: 'Test Challenge',
    challenge_type: 'weight_loss',
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    registration_deadline: startDate.toISOString(),
    creator_id: 'test-user-id',
    invite_code: 'TEST123',
    participant_count: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create mock participant
export function createMockParticipant(overrides: Partial<any> = {}) {
  return {
    id: 'test-participant-id',
    challenge_id: 'test-challenge-id',
    user_id: 'test-user-id',
    status: 'active',
    joined_at: new Date().toISOString(),
    starting_value: 95,
    target_value: 85,
    ...overrides,
  };
}
