const { Buffer } = require('buffer');
const fs = require('fs');
const { test } = require('@playwright/test');

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function attachPng(name = 'shot.png') {
  const testInfo = test.info();
  const path = testInfo.outputPath(name);
  fs.writeFileSync(path, PNG);
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('plays video', async () => {
  await attachPng();
});

test('Playback / live: stream resumes?', async () => {
  await attachPng();
});

// Sanitizes to the same prefix as the test above.
test('Playback : live/ stream resumes?', async () => {
  await attachPng();
});

test('issue #12 at 100% \\ done', async () => {
  await attachPng();
});

test('x'.repeat(300), async () => {
  await attachPng();
});

// 400 UTF-8 bytes in 100 characters.
test('🎬'.repeat(100), async () => {
  await attachPng();
});

// Pushed directly, so Playwright does not sanitize the file name.
test('manual attachment #1', async () => {
  const testInfo = test.info();
  const path = testInfo.outputPath('shot#1.png');
  fs.writeFileSync(path, PNG);
  testInfo.attachments.push({ name: 'shot', path, contentType: 'image/png' });
});

test('attachment removed later', async () => {
  await attachPng();
  fs.rmSync(test.info().attachments.at(-1).path);
});
