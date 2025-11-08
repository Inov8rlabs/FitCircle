# FitCircle Testing Architecture

## Testing Stack

### Unit & Integration Tests
- **Vitest** - Fast, modern test runner with native ESM support
- **@testing-library/react** - Component testing
- **@testing-library/user-event** - User interaction simulation
- **@testing-library/jest-dom** - Custom matchers

### API & Database Mocking
- **MSW (Mock Service Worker)** - API mocking
- **vitest-mock-extended** - Advanced mocking utilities
- **@supabase/supabase-js** mocks - Database operation mocking

### E2E Tests
- **Playwright** - Modern E2E testing framework

### Coverage
- **@vitest/coverage-v8** - Code coverage reporting

## Test Categories

### 1. Unit Tests (`*.test.ts`, `*.test.tsx`)
- Service layer functions
- Utility functions
- Custom hooks
- Pure components
- Store logic

### 2. Integration Tests (`*.integration.test.ts`)
- API routes
- Database operations
- Authentication flows
- Multi-component interactions

### 3. E2E Tests (`*.spec.ts` in `/e2e`)
- Complete user journeys
- Critical paths
- Cross-browser compatibility

## Coverage Goals

- **Services**: 90%+
- **API Routes**: 85%+
- **Components**: 80%+
- **Utilities**: 95%+
- **Overall**: 85%+

## Directory Structure

```
apps/web/
├── __tests__/
│   ├── unit/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── hooks/
│   │   └── stores/
│   ├── integration/
│   │   ├── api/
│   │   └── components/
│   └── utils/
│       ├── test-utils.tsx      # Testing library setup
│       ├── mock-supabase.ts     # Supabase mocks
│       └── mock-handlers.ts     # MSW handlers
├── e2e/
│   ├── auth.spec.ts
│   ├── onboarding.spec.ts
│   ├── fitcircle.spec.ts
│   └── dashboard.spec.ts
├── vitest.config.ts
└── playwright.config.ts
```

## Running Tests

```bash
# Unit & Integration Tests
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage
npm run test:ui           # Vitest UI

# E2E Tests
npm run test:e2e          # All E2E tests
npm run test:e2e:ui       # With Playwright UI
npm run test:e2e:debug    # Debug mode

# CI Pipeline
npm run test:ci           # All tests for CI
```

## Key Testing Patterns

### API Route Testing
```typescript
// Test authentication, authorization, validation, and business logic
import { GET, POST } from '@/app/api/endpoint/route'
import { createMockRequest, createMockContext } from '@/tests/utils/test-utils'
```

### Component Testing
```typescript
// Test rendering, user interactions, and state changes
import { render, screen, userEvent } from '@/tests/utils/test-utils'
```

### Service Testing
```typescript
// Test business logic with mocked database
import { mockSupabase } from '@/tests/utils/mock-supabase'
```

### Store Testing
```typescript
// Test state management without React
import { renderHook } from '@testing-library/react'
```

## Mocking Strategy

### Supabase Client
- Mock at module level
- Provide typed responses
- Test both success and error paths

### Next.js Features
- Mock `next/navigation`
- Mock `next/headers`
- Mock Server Actions

### External Services
- Amplitude (analytics)
- File uploads
- Email services (future)
