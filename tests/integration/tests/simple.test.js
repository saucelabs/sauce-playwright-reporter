const { test, expect } = require('@playwright/test');

test('should verify title of the page', async ({ page }, testInfo) => {
  await page.goto('https://www.saucedemo.com/');

  const path = testInfo.outputPath('screenshot.png');
  await page.screenshot({ path });
  testInfo.attachments.push({ name: 'screenshot', path, contentType: 'image/png' });

  expect(await page.title()).toBe('Swag Labs');
});
