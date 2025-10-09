# FitCircle Testing Guide

## Quick Start

### 1. Install Dependencies

The project uses workspace protocol for local packages, which requires a workspace-compatible package manager:

**Option A: Using Bun (Recommended - as specified in package.json)**
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
```

**Option B: Using Yarn**
```bash
# Install Yarn
npm install -g yarn

# Install dependencies
yarn install
```

**Option C: Using pnpm**
```bash
# Install pnpm
npm install -g pnpm

# Install dependencies
pnpm install
```

### 2. Run Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Open coverage report
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
start coverage/index.html  # Windows
```

### 3. Run E2E Tests

```bash
# Install Playwright browsers (one-time setup)
npx playwright install

# Run E2E tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Run E2E tests in debug mode
npm run test:e2e:debug
```

## Test Commands Reference

### Unit & Integration Tests (Vitest)

| Command | Description |
|---------|-------------|
| `npm run test` | Run all unit and integration tests |
| `npm run test:watch` | Run tests in watch mode (re-runs on file changes) |
| `npm run test:coverage` | Run tests and generate coverage report |
| `npm run test:ui` | Open Vitest UI for interactive testing |

### E2E Tests (Playwright)

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run all E2E tests |
| `npm run test:e2e:ui` | Run E2E tests with Playwright UI |
| `npm run test:e2e:debug` | Run E2E tests in debug mode with inspector |

### CI/CD

| Command | Description |
|---------|-------------|
| `npm run test:ci` | Run all tests (unit + integration + E2E) for CI |

## Test Structure

```
apps/web/
├── __tests__/                    # Test files
│   ├── utils/                    # Test utilities and mocks
│   │   ├── test-setup.ts         # Global test setup
│   │   ├── test-utils.tsx        # Helper functions and mock factories
│   │   └── mock-supabase.ts      # Supabase client mocks
│   ├── unit/                     # Unit tests
│   │   ├── services/             # Service layer tests
│   │   ├── hooks/                # Custom hooks tests
│   │   └── utils/                # Utility function tests
│   └── integration/              # Integration tests
│       ├── api/                  # API route tests
│       └── components/           # Component tests
├── e2e/                          # End-to-end tests
│   ├── auth.spec.ts              # Authentication flow tests
│   └── fitcircle-management.spec.ts  # FitCircle management tests
├── vitest.config.ts              # Vitest configuration
└── playwright.config.ts          # Playwright configuration
```

## Writing Tests

### Unit Test Example

```typescript
// __tests__/unit/services/my-service.test.ts
import { describe, it, expect } from 'vitest';
import { MyService } from '@/lib/services/my-service';

describe('MyService', () => {
  describe('myMethod', () => {
    it('should return correct result', () => {
      const result = MyService.myMethod(input);
      expect(result).toBe(expected);
    });
  });
});
```

### API Integration Test Example

```typescript
// __tests__/integration/api/my-route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/my-route/route';
import { createMockRequest, createMockContext } from '../../utils/test-utils';
import { createMockSupabaseClient } from '../../utils/mock-supabase';

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: vi.fn(),
}));

describe('GET /api/my-route', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  it('should return data', async () => {
    const { createServerSupabase } = await import('@/lib/supabase-server');
    (createServerSupabase as any).mockResolvedValue(mockSupabase);

    const request = createMockRequest('GET');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toBeDefined();
  });
});
```

### Component Test Example

```typescript
// __tests__/integration/components/my-component.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, userEvent } from '../../utils/test-utils';
import { MyComponent } from '@/components/MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('should handle click', async () => {
    const user = userEvent.setup();
    const mockFn = vi.fn();

    render(<MyComponent onClick={mockFn} />);
    await user.click(screen.getByRole('button'));

    expect(mockFn).toHaveBeenCalled();
  });
});
```

### E2E Test Example

```typescript
// e2e/my-feature.spec.ts
import { test, expect } from '@playwright/test';

test.describe('My Feature', () => {
  test('should complete user flow', async ({ page }) => {
    await page.goto('/');

    await page.click('button:has-text("Start")');
    await expect(page).toHaveURL('/next-page');

    await page.fill('input[name="field"]', 'value');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

## Test Utilities

### Mock Factories

```typescript
// Create mock user
const user = createMockUser({ id: 'custom-id' });

// Create mock profile
const profile = createMockProfile({ username: 'testuser' });

// Create mock challenge
const challenge = createMockChallenge({ name: 'Test Challenge' });

// Create mock participant
const participant = createMockParticipant({ user_id: 'user-id' });

// Create mock request
const request = createMockRequest('POST', { data: 'value' });

// Create mock context
const context = createMockContext({ id: 'resource-id' });
```

### Supabase Mocks

```typescript
// Create mock Supabase client
const mockSupabase = createMockSupabaseClient();

// Mock authenticated user
mockSupabase.auth.getUser.mockResolvedValue(
  mockAuthenticatedUser('user-id')
);

// Mock successful query
mockSupabase.from.mockReturnValue({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue(mockQuerySuccess(data)),
});

// Mock query error
mockSupabase.from.mockReturnValue({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue(mockQueryError('Error message')),
});
```

## Coverage Reports

After running `npm run test:coverage`, open the HTML report:

```bash
# macOS
open coverage/index.html

# Linux
xdg-open coverage/index.html

# Windows
start coverage/index.html
```

The coverage report shows:
- **Lines:** % of code lines executed
- **Functions:** % of functions called
- **Branches:** % of conditional branches taken
- **Statements:** % of statements executed

**Coverage Thresholds:**
- Services: 90%+
- API Routes: 85%+
- Components: 80%+
- Overall: 85%+

## Troubleshooting

### Issue: Tests failing with "Cannot find module '@/...'"

**Solution:** Ensure `vitest.config.ts` has correct path alias:

```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './app'),
  },
}
```

### Issue: Supabase mocks not working

**Solution:** Ensure mock is set up before importing the route:

```typescript
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: vi.fn(),
}));

// THEN import the route
import { GET } from '@/app/api/my-route/route';
```

### Issue: E2E tests timing out

**Solution:** Increase timeout in test:

```typescript
test('my test', async ({ page }) => {
  // ... test code
}, { timeout: 30000 }); // 30 seconds
```

Or update global timeout in `playwright.config.ts`.

### Issue: Playwright browsers not installed

**Solution:** Run Playwright install command:

```bash
npx playwright install
```

### Issue: React 19 RC peer dependency warnings

**Solution:** This is expected. The project uses React 19 RC. Tests will still work.

### Issue: Workspace protocol error with npm

**Solution:** Use Bun, Yarn, or pnpm instead of npm (see installation section above).

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Run tests
        run: npm run test:ci

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

## Best Practices

1. **Write tests first (TDD)** - Define expected behavior before implementation
2. **Test behavior, not implementation** - Don't test internal details
3. **Keep tests isolated** - Each test should be independent
4. **Use descriptive test names** - "should do X when Y happens"
5. **Test edge cases** - Empty inputs, null values, errors
6. **Mock external dependencies** - Supabase, APIs, file system
7. **Avoid testing library code** - Focus on your business logic
8. **Keep tests fast** - Unit tests should run in milliseconds
9. **Use factories for test data** - DRY principle for mock data
10. **Clean up after tests** - Use `afterEach` to reset state

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library Documentation](https://testing-library.com/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Architecture](../../TESTING_ARCHITECTURE.md)
- [Test Coverage Report](../../TEST_COVERAGE_REPORT.md)

## Support

For issues or questions about testing:
1. Check existing tests for examples
2. Review test utilities in `__tests__/utils/`
3. Consult the coverage report for gaps
4. Create an issue in the repository

---

**Happy Testing! 🧪**
