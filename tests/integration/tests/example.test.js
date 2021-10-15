const { test, expect } = require('@playwright/test');

test.describe('grouping root level', async () => {
    test('should verify title of the page', async ({ page }, testInfo) => {
        await page.goto('https://www.saucedemo.com/');

        const path = testInfo.outputPath('screenshot.png');
        await page.screenshot({ path });
        testInfo.attachments.push({ name: 'screenshot', path, contentType: 'image/png' });

        expect(await page.title()).toBe('Swag Labs');
    });

    test.describe('grouping nested level', async () => {
        test('should verify title of the page - 2', async ({ page }, testInfo) => {
            await page.goto('https://www.saucedemo.com/');

            const path = testInfo.outputPath('screenshot.png');
            await page.screenshot({ path });
            testInfo.attachments.push({ name: 'screenshot', path, contentType: 'image/png' });

            expect(await page.title()).toBe('Swag Labs');
        });

        test('should verify title of the page - failing', async ({ page }, testInfo) => {
            await page.goto('https://www.saucedemo.com/');

            const path = testInfo.outputPath('screenshot.png');
            await page.screenshot({ path });
            testInfo.attachments.push({ name: 'screenshot', path, contentType: 'image/png' });

            expect(await page.title()).toBe('Swag Labs');
        });
    });
});
