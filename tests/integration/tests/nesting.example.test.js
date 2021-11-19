const { test, expect } = require('@playwright/test');

test('file level test', async ({ page }) => {
  await page.goto('https://www.saucedemo.com/');

  expect(await page.title()).toBe('Swag Labs');
});

test.describe('grouping root level', async () => {
  test('should verify title of the page', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');

    expect(await page.title()).toBe('Swag Labs');
  });

  test.describe('grouping nested level', async () => {
    test('should verify title of the page - 2', async ({ page }) => {
      await page.goto('https://www.saucedemo.com/');

      expect(await page.title()).toBe('Swag Labs');
    });

    test('should verify title of the page - failing', async ({ page }) => {
      await page.goto('https://www.saucedemo.com/');

      expect(await page.title()).toBe('Swag Labs');
    });

    test.describe('nested level 2', async () => {
      test('level 2 test', async ({ page }) => {
        await page.goto('https://www.saucedemo.com/');

        expect(await page.title()).toBe('Swag Labs');
      });
    });
  });
});
