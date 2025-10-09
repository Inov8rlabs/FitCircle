import { test, expect } from '@playwright/test';

test.describe('FitCircle Creation and Management', () => {
  test.beforeEach(async ({ page }) => {
    // Note: These tests require authenticated user
    // In CI, use test fixtures or mock authentication
    await page.goto('/dashboard');
  });

  test.skip('should create a new FitCircle', async ({ page }) => {
    await page.click('button:has-text("Create FitCircle")');

    // Fill in challenge details
    await page.fill('input[name="name"]', 'Summer Weight Loss Challenge');
    await page.selectOption('select[name="type"]', 'weight_loss');

    // Set dates
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 30);

    await page.fill(
      'input[name="start_date"]',
      start.toISOString().split('T')[0]
    );
    await page.fill(
      'input[name="end_date"]',
      end.toISOString().split('T')[0]
    );

    await page.click('button[type="submit"]');

    // Should show success message
    await expect(page.locator('text=/created|success/i')).toBeVisible();

    // Should show the new challenge
    await expect(
      page.locator('text=Summer Weight Loss Challenge')
    ).toBeVisible();
  });

  test.skip('should open manage menu for created FitCircle', async ({
    page,
  }) => {
    // Click on a FitCircle card
    await page.click('[data-testid="fitcircle-card"]').first();

    // Wait for detail page
    await expect(page).toHaveURL(/\/fitcircles\/.+/);

    // Open manage menu (only visible to creator)
    await page.click('button:has-text("Manage")');

    // Should show manage options
    await expect(page.locator('text=Edit Details')).toBeVisible();
    await expect(page.locator('text=Remove Participants')).toBeVisible();
    await expect(page.locator('text=Share')).toBeVisible();
  });

  test.skip('should edit FitCircle name', async ({ page }) => {
    await page.goto('/fitcircles/test-challenge-id'); // Use test fixture

    await page.click('button:has-text("Manage")');
    await page.click('button:has-text("Edit Name")');

    // Edit the name
    await page.fill('input[name="name"]', 'Updated Challenge Name');
    await page.click('button:has-text("Save")');

    // Should show success and updated name
    await expect(page.locator('text=Updated Challenge Name')).toBeVisible();
  });

  test.skip('should edit start date without timezone shift', async ({
    page,
  }) => {
    await page.goto('/fitcircles/test-challenge-id');

    await page.click('button:has-text("Manage")');
    await page.click('button:has-text("Edit Start Date")');

    // Set to September 1st
    await page.fill('input[type="date"]', '2025-09-01');
    await page.click('button:has-text("Save")');

    // Verify it shows as Sept 1, not Aug 31 (timezone bug fix)
    await expect(page.locator('text=/Sep.*1/i')).toBeVisible();
    await expect(page.locator('text=/Aug.*31/i')).not.toBeVisible();
  });

  test.skip('should edit end date', async ({ page }) => {
    await page.goto('/fitcircles/test-challenge-id');

    await page.click('button:has-text("Manage")');
    await page.click('button:has-text("Edit End Date")');

    const newEndDate = new Date();
    newEndDate.setDate(newEndDate.getDate() + 60);

    await page.fill(
      'input[type="date"]',
      newEndDate.toISOString().split('T')[0]
    );
    await page.click('button:has-text("Save")');

    // Should show updated date
    await expect(
      page.locator(`text=/${newEndDate.toLocaleDateString()}/i`)
    ).toBeVisible();
  });

  test.skip('should validate start date before end date', async ({ page }) => {
    await page.goto('/fitcircles/test-challenge-id');

    await page.click('button:has-text("Manage")');
    await page.click('button:has-text("Edit Start Date")');

    // Try to set start date after end date
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    await page.fill(
      'input[type="date"]',
      futureDate.toISOString().split('T')[0]
    );
    await page.click('button:has-text("Save")');

    // Should show validation error
    await expect(
      page.locator('text=/start.*before.*end|invalid.*date/i')
    ).toBeVisible();
  });

  test.skip('should remove participant with confirmation', async ({ page }) => {
    await page.goto('/fitcircles/test-challenge-id');

    await page.click('button:has-text("Manage")');
    await page.click('button:has-text("Remove Participants")');

    // Click remove on a participant
    await page.click('[data-testid="remove-participant-btn"]').first();

    // Should show confirmation dialog
    await expect(
      page.locator('text=/are you sure|confirm/i')
    ).toBeVisible();

    // Confirm removal
    await page.click('button:has-text("Confirm")');

    // Should show success message
    await expect(page.locator('text=/removed|success/i')).toBeVisible();
  });

  test.skip('should not allow removing the creator', async ({ page }) => {
    await page.goto('/fitcircles/test-challenge-id');

    await page.click('button:has-text("Manage")');
    await page.click('button:has-text("Remove Participants")');

    // Try to remove creator (should not have remove button)
    const creatorCard = page.locator('[data-testid="creator-card"]');
    await expect(
      creatorCard.locator('button:has-text("Remove")')
    ).not.toBeVisible();
  });

  test.skip('should share FitCircle invite link', async ({ page }) => {
    await page.goto('/fitcircles/test-challenge-id');

    await page.click('button:has-text("Share")');

    // Should show invite link
    await expect(page.locator('text=/invite.*link/i')).toBeVisible();

    // Should have copy button
    const copyBtn = page.locator('button:has-text("Copy")');
    await expect(copyBtn).toBeVisible();

    await copyBtn.click();

    // Should show copied confirmation
    await expect(page.locator('text=/copied/i')).toBeVisible();
  });
});

test.describe('FitCircle Participant View', () => {
  test.skip('should not show manage button for non-creators', async ({
    page,
  }) => {
    // Login as non-creator participant
    await page.goto('/fitcircles/test-challenge-id');

    // Should NOT show manage button
    await expect(page.locator('button:has-text("Manage")')).not.toBeVisible();

    // Should show share button (all members can share)
    await expect(page.locator('button:has-text("Share")')).toBeVisible();
  });

  test.skip('should display leaderboard correctly', async ({ page }) => {
    await page.goto('/fitcircles/test-challenge-id');

    // Should show leaderboard
    await expect(page.locator('[data-testid="leaderboard"]')).toBeVisible();

    // Should show participant stats
    await expect(page.locator('text=/progress/i')).toBeVisible();
    await expect(page.locator('text=/entries/i')).toBeVisible();
  });

  test.skip('should show 0% progress for users with no entries', async ({
    page,
  }) => {
    await page.goto('/fitcircles/test-challenge-id');

    // User with 0 entries should show 0%, not 100%
    const zeroEntryUser = page.locator('[data-testid="user-0-entries"]');
    await expect(zeroEntryUser.locator('text=0%')).toBeVisible();
    await expect(zeroEntryUser.locator('text=100%')).not.toBeVisible();
  });
});

test.describe('Invite Flow', () => {
  test.skip('should join FitCircle via invite link', async ({ page }) => {
    // Visit invite link as authenticated user
    await page.goto('/join/TEST123'); // Test invite code

    // Should show challenge preview
    await expect(page.locator('text=/challenge.*details/i')).toBeVisible();

    // Fill in goals
    await page.fill('input[name="starting_weight"]', '95');
    await page.fill('input[name="target_weight"]', '85');

    await page.click('button:has-text("Join Challenge")');

    // Should redirect to challenge page
    await expect(page).toHaveURL(/\/fitcircles\/.+/);

    // Should show success message
    await expect(page.locator('text=/joined|welcome/i')).toBeVisible();
  });

  test.skip('should redirect to welcome page for unauthenticated users', async ({
    page,
    context,
  }) => {
    // Clear auth cookies
    await context.clearCookies();

    await page.goto('/join/TEST123');

    // Should show welcome page
    await expect(page).toHaveURL(/\/welcome/);
    await expect(page.locator('text=/sign up|create account/i')).toBeVisible();
  });

  test.skip('should preserve returnUrl through signup flow', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    // Start with invite link
    await page.goto('/join/TEST123');

    // Click sign up
    await page.click('button:has-text("Sign Up")');

    // Complete signup
    const email = `test${Date.now()}@example.com`;
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');

    // Complete onboarding
    // ... onboarding steps ...

    // Should redirect back to join page after onboarding
    await expect(page).toHaveURL(/\/join\/TEST123/);
  });
});
