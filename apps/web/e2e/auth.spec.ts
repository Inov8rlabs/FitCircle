import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should show login page for unauthenticated users', async ({ page }) => {
    await expect(page).toHaveURL('/login');
    await expect(page.locator('h1')).toContainText(/sign in|log in/i);
  });

  test('should show sign up form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should validate email format', async ({ page }) => {
    await page.goto('/signup');

    await page.fill('input[type="email"]', 'invalid-email');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Should show email validation error
    await expect(page.locator('text=/invalid.*email/i')).toBeVisible();
  });

  test('should validate password requirements', async ({ page }) => {
    await page.goto('/signup');

    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', '123'); // Too short
    await page.click('button[type="submit"]');

    // Should show password validation error
    await expect(page.locator('text=/password.*characters/i')).toBeVisible();
  });

  test('should redirect to onboarding after successful signup', async ({
    page,
  }) => {
    // Note: This test requires test database setup
    await page.goto('/signup');

    const timestamp = Date.now();
    const email = `test${timestamp}@example.com`;

    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');

    // Should redirect to onboarding
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10000 });
  });

  test('should show error for invalid credentials on login', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.fill('input[type="email"]', 'nonexistent@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(
      page.locator('text=/invalid.*credentials|wrong.*password/i')
    ).toBeVisible();
  });
});

test.describe('Onboarding Flow', () => {
  test.skip('should complete onboarding and show celebration', async ({
    page,
  }) => {
    // This test requires authenticated user
    // Skip in CI unless test user is set up

    await page.goto('/onboarding');

    // Step 1: Profile info
    await page.fill('input[name="username"]', 'testuser');
    await page.fill('input[name="display_name"]', 'Test User');
    await page.click('button:has-text("Next")');

    // Step 2: Goals
    await page.click('[data-testid="goal-weight-loss"]');
    await page.fill('input[name="starting_weight"]', '95');
    await page.fill('input[name="target_weight"]', '85');
    await page.click('button:has-text("Next")');

    // Step 3: Complete
    await page.click('button:has-text("Complete")');

    // Should show celebration animation
    await expect(page.locator('[data-testid="celebration"]')).toBeVisible();

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard', { timeout: 10000 });
  });
});

test.describe('Logout Flow', () => {
  test.skip('should logout and redirect to login', async ({ page }) => {
    // Requires authenticated user
    await page.goto('/dashboard');

    await page.click('[data-testid="user-menu"]');
    await page.click('button:has-text("Logout")');

    // Should redirect to login
    await expect(page).toHaveURL('/login');
  });
});
