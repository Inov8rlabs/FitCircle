import { test, expect } from '@playwright/test';

test.describe('Food & Beverage Logging', () => {
    // Mock Authentication
    test.use({
        storageState: {
            cookies: [],
            origins: [
                {
                    origin: 'http://localhost:3000',
                    localStorage: [
                        {
                            name: 'fitcircle-auth-store',
                            value: JSON.stringify({
                                state: {
                                    user: {
                                        id: 'test-user-id',
                                        email: 'test@example.com',
                                        name: 'Test User',
                                        level: 1,
                                        avatar: 'https://github.com/shadcn.png',
                                    },
                                    isAuthenticated: true,
                                },
                                version: 0,
                            }),
                        },
                    ],
                },
            ],
        },
    });

    test.beforeEach(async ({ page }) => {
        // Mock API responses
        await page.route('**/rest/v1/food_log_entries*', async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([]),
                });
            } else if (route.request().method() === 'POST') {
                await route.fulfill({
                    status: 201,
                    contentType: 'application/json',
                    body: JSON.stringify({ id: 'new-entry-id' }),
                });
            } else if (route.request().method() === 'DELETE') {
                await route.fulfill({ status: 204 });
            } else {
                await route.continue();
            }
        });

        await page.route('**/rest/v1/beverage_logs*', async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([]),
                });
            } else if (route.request().method() === 'POST') {
                await route.fulfill({
                    status: 201,
                    contentType: 'application/json',
                    body: JSON.stringify({ id: 'new-beverage-id' }),
                });
            } else if (route.request().method() === 'DELETE') {
                await route.fulfill({ status: 204 });
            } else {
                await route.continue();
            }
        });

        await page.goto('/food-log');
    });

    test('should navigate to food log page', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Food & Drink' })).toBeVisible();
        await expect(page.getByText('Track your nutrition and hydration')).toBeVisible();
    });

    test('should create a meal entry', async ({ page }) => {
        await page.getByRole('button').filter({ hasChild: page.locator('svg.lucide-plus') }).click();
        await expect(page.getByRole('heading', { name: 'New Entry' })).toBeVisible();

        // Select Meal
        await page.getByText('Meal', { exact: true }).click();

        // Select Lunch
        await page.getByRole('button', { name: 'lunch' }).click();

        // Add notes
        await page.getByPlaceholder('Add any details...').fill('Grilled Chicken Salad');

        // Save
        await page.getByRole('button', { name: 'Save Entry' }).click();

        // Verify redirect and toast
        await expect(page).toHaveURL('/food-log');
        await expect(page.getByText('Entry saved!')).toBeVisible();
    });

    test('should create a water entry', async ({ page }) => {
        await page.getByRole('button').filter({ hasChild: page.locator('svg.lucide-plus') }).click();

        // Select Water
        await page.getByText('Water', { exact: true }).click();

        // Select Preset
        await page.getByText('Glass').click();

        // Verify input updates
        await expect(page.getByLabel('Custom Amount (ml)')).toHaveValue('240');

        // Save
        await page.getByRole('button', { name: 'Save Entry' }).click();

        // Verify redirect
        await expect(page).toHaveURL('/food-log');
    });

    test('should create a beverage entry', async ({ page }) => {
        await page.getByRole('button').filter({ hasChild: page.locator('svg.lucide-plus') }).click();

        // Select Coffee
        await page.getByText('Coffee', { exact: true }).click();

        // Select Latte
        await page.getByText('Latte').click();

        // Verify nutrition preview
        await expect(page.getByText('Nutrition Preview')).toBeVisible();
        await expect(page.getByText('190 kcal')).toBeVisible();

        // Save
        await page.getByRole('button', { name: 'Save Entry' }).click();

        // Verify redirect
        await expect(page).toHaveURL('/food-log');
    });
});
