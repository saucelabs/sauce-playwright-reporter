import { test, expect } from '@playwright/test';

test('@implicit tag in title', async ({ page }) => {
  await page.goto('https://www.saucedemo.com/');

  expect(await page.title()).toBe('Swag Labs');
});

test('explicit tag argument', { tag: '@explicit' }, async ({ page }) => {
  await page.goto('https://www.saucedemo.com/');

  expect(await page.title()).toBe('Swag Labs');
});

test('built in annotation', async ({ page }) => {
  test.slow();

  await page.goto('https://www.saucedemo.com/');

  expect(await page.title()).toBe('Swag Labs');
});

test(
  'annotations',
  { annotation: { type: 'static annotation' } },
  async ({ page }) => {
    test.info().annotations.push({
      type: 'runtime annotation',
      description: 'annotation added during test execution',
    });
    await page.goto('https://www.saucedemo.com/');

    expect(await page.title()).toBe('Swag Labs');
  },
);
