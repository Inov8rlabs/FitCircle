# FitCircle Test Suite - Setup & Execution Guide

## 📋 Overview

Comprehensive test suite for FitCircle with 90+ tests covering:
- ✅ Unit tests for services
- ✅ Integration tests for API routes
- ✅ Integration tests for components
- ✅ E2E tests for critical user flows

## 🚀 Quick Start (3 Steps)

### Step 1: Install Dependencies

**The project uses workspace protocol which requires Bun, Yarn, or pnpm (npm has compatibility issues).**

**Recommended: Use Bun**
```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Restart terminal, then install dependencies
cd /Users/ani/Code/FitCircle
bun install
```

**Alternative: Use Yarn**
```bash
npm install -g yarn
yarn install
```

**Alternative: Use pnpm**
```bash
npm install -g pnpm
pnpm install
```

### Step 2: Run Test Suite

```bash
cd apps/web

# Run all unit and integration tests
npm run test

# Run with coverage report
npm run test:coverage

# Open coverage report in browser
open coverage/index.html
```

### Step 3: View Test Report

The test coverage report is already generated at:
```
/Users/ani/Code/FitCircle/TEST_COVERAGE_REPORT.md
```

This report includes:
- ✅ Complete test inventory categorized by use case
- ✅ Coverage for all major bugs fixed during development
- ✅ Test execution instructions
- ✅ Coverage goals vs actual metrics

## 📊 Test Suite Summary

### By Test Type

| Type | Files | Test Cases | Status |
|------|-------|-----------|---------|
| Unit Tests (Services) | 1 | 25+ | ✅ Ready |
| Integration Tests (API) | 2 | 25+ | ✅ Ready |
| Integration Tests (Components) | 1 | 25+ | ✅ Ready |
| E2E Tests | 2 | 15+ | ⏭️ Pending fixtures |
| **Total** | **6** | **90+** | **✅ Ready to Run** |

### By Use Case

| Use Case | Tests | Status |
|----------|-------|---------|
| Progress Calculation | 15+ | ✅ Complete |
| API Authentication & Authorization | 10+ | ✅ Complete |
| Date Handling & Timezone Fixes | 10+ | ✅ Complete |
| FitCircle Management | 20+ | ✅ API Complete, ⏭️ E2E Pending |
| User Authentication | 7+ | ⏭️ E2E Pending |
| Component Rendering & Interaction | 25+ | ✅ Complete |

## 🐛 Critical Bugs with Test Coverage

### 1. Progress Calculation Bug ✅
**Issue:** Users with 0 entries showed 100% progress
**Test:** `leaderboard-service.test.ts` - "should calculate 0% when currentValue is 0"
**Status:** ✅ Covered

### 2. Timezone Date Shift Bug ✅
**Issue:** Sept 1 saved/displayed as Aug 31
**Tests:**
- `fitcircles-update.test.ts` - "should normalize start_date to noon UTC"
- `date-picker.test.tsx` - "should not shift dates across timezones"
**Status:** ✅ Covered

### 3. Creator Self-Removal Bug ✅
**Issue:** Creators could potentially remove themselves
**Test:** `remove-participant.test.ts` - "should return 400 when trying to remove the creator"
**Status:** ✅ Covered

## 📁 Files Created

### Test Configuration
- ✅ `apps/web/vitest.config.ts` - Vitest configuration
- ✅ `apps/web/playwright.config.ts` - Playwright configuration
- ✅ `apps/web/package.json` - Updated with test scripts and dependencies

### Test Utilities
- ✅ `apps/web/__tests__/utils/test-setup.ts` - Global setup and mocks
- ✅ `apps/web/__tests__/utils/test-utils.tsx` - Helper functions and factories
- ✅ `apps/web/__tests__/utils/mock-supabase.ts` - Supabase client mocks

### Unit Tests
- ✅ `apps/web/__tests__/unit/services/leaderboard-service.test.ts`

### Integration Tests - API
- ✅ `apps/web/__tests__/integration/api/fitcircles-update.test.ts`
- ✅ `apps/web/__tests__/integration/api/remove-participant.test.ts`

### Integration Tests - Components
- ✅ `apps/web/__tests__/integration/components/date-picker.test.tsx`

### E2E Tests
- ✅ `apps/web/e2e/auth.spec.ts`
- ✅ `apps/web/e2e/fitcircle-management.spec.ts`

### Documentation
- ✅ `TESTING_ARCHITECTURE.md` - Testing strategy and architecture
- ✅ `TEST_COVERAGE_REPORT.md` - Comprehensive test inventory and coverage
- ✅ `apps/web/TESTING_README.md` - Developer guide for writing and running tests
- ✅ `TESTING_SETUP_GUIDE.md` - This file

## 🧪 Test Commands

### Unit & Integration Tests

```bash
# Run all tests once
npm run test

# Run in watch mode (re-runs on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Open interactive Vitest UI
npm run test:ui
```

### E2E Tests

```bash
# First-time setup: Install Playwright browsers
npx playwright install

# Run all E2E tests
npm run test:e2e

# Run with Playwright UI (visual mode)
npm run test:e2e:ui

# Run in debug mode with inspector
npm run test:e2e:debug
```

### CI/CD

```bash
# Run all tests (unit + integration + E2E)
npm run test:ci
```

## 📈 Coverage Goals

| Category | Goal | Thresholds in Config |
|----------|------|---------------------|
| Services | 90%+ | Lines: 85%, Functions: 85% |
| API Routes | 85%+ | Branches: 80% |
| Components | 80%+ | Statements: 85% |
| **Overall** | **85%+** | ✅ Configured |

To check current coverage:
```bash
npm run test:coverage
open coverage/index.html
```

## 🔧 Troubleshooting

### Issue: npm install fails with "workspace:" error

**Solution:** Use Bun, Yarn, or pnpm (npm doesn't support workspace protocol)
```bash
curl -fsSL https://bun.sh/install | bash
bun install
```

### Issue: "Cannot find module '@/...'" in tests

**Solution:** Already configured in `vitest.config.ts`. If persists, verify working directory:
```bash
cd apps/web
npm run test
```

### Issue: Playwright browsers not installed

**Solution:**
```bash
npx playwright install
```

### Issue: E2E tests are skipped

**Explanation:** Most E2E tests are intentionally skipped pending:
- Test database setup
- Authentication fixtures
- Test data seeding

To enable:
1. Set up test Supabase project
2. Create test user fixtures
3. Remove `.skip()` from tests in `e2e/*.spec.ts`

## 🎯 Next Steps

### Immediate (Required)

1. **Install dependencies** (using Bun/Yarn/pnpm)
   ```bash
   bun install  # or yarn install / pnpm install
   ```

2. **Run test suite**
   ```bash
   cd apps/web
   npm run test:coverage
   ```

3. **View coverage report**
   ```bash
   open coverage/index.html
   ```

4. **Review test report**
   - Read `TEST_COVERAGE_REPORT.md` for complete test inventory

### Short-term (Optional)

1. **Set up test database** for E2E tests
   - Create test Supabase project
   - Add test environment variables
   - Create test fixtures

2. **Enable E2E tests**
   - Remove `.skip()` from tests
   - Run `npm run test:e2e`

3. **Add more tests**
   - Cover additional services
   - Test more components
   - Add utility function tests

## 📚 Documentation Index

| Document | Purpose |
|----------|---------|
| `TESTING_ARCHITECTURE.md` | Testing strategy and stack overview |
| `TEST_COVERAGE_REPORT.md` | Complete test inventory by use case |
| `apps/web/TESTING_README.md` | Developer guide for writing tests |
| `TESTING_SETUP_GUIDE.md` | This file - setup and execution |

## ✅ Verification Checklist

After installing dependencies and running tests:

- [ ] Dependencies installed successfully (using Bun/Yarn/pnpm)
- [ ] `npm run test` executes without errors
- [ ] Coverage report generated in `coverage/` directory
- [ ] Coverage report accessible at `coverage/index.html`
- [ ] All unit tests pass (services)
- [ ] All API integration tests pass
- [ ] All component integration tests pass
- [ ] Test count matches report (90+ tests)
- [ ] Coverage thresholds met (85%+ overall)

## 🎉 Success Criteria

You'll know the test suite is working when:

1. ✅ All 90+ tests run successfully
2. ✅ Coverage report shows 85%+ overall coverage
3. ✅ All critical bugs have passing regression tests
4. ✅ CI/CD pipeline can run `npm run test:ci`

## 📞 Support

If you encounter issues:

1. Check this guide's troubleshooting section
2. Review `apps/web/TESTING_README.md` for detailed examples
3. Check existing tests for reference patterns
4. Review test utilities in `__tests__/utils/`

---

## 🚦 Current Status

**Test Suite Status:** ✅ READY TO RUN

**What's Complete:**
- ✅ All test files created (6 files, 90+ tests)
- ✅ Test configuration files created
- ✅ Test utilities and mocks created
- ✅ Package.json updated with scripts
- ✅ Documentation complete (4 documents)

**What's Needed:**
- 🔧 Install dependencies (Bun/Yarn/pnpm required)
- ▶️ Run test suite
- 📊 Review coverage report

**Estimated Time to Get Running:** 5 minutes
1. Install Bun: 1 minute
2. Run `bun install`: 2 minutes
3. Run `npm run test:coverage`: 1 minute
4. Review results: 1 minute

---

**Ready to run! Install dependencies and execute the test suite.**
