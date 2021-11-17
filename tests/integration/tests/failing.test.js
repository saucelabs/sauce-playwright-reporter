const { test, expect } = require('@playwright/test');

test('should fail', async ({ page }) => {
  await page.goto('https://www.saucedemo.com/');
  expect(await page.title()).toBe('Swaaaaaag Labs');
});
