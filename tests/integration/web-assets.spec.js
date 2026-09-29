require('jest');

const { Buffer } = require('buffer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.join(__dirname, 'web-assets');
const assetsDir = path.join(cwd, '__assets__');
const reportFile = path.join(cwd, 'sauce-test-report.json');
const unsafeChars = /[/\\:*?"<>|#%]/;

let output;
let tests;

function collectTests(suites) {
  return suites.flatMap((s) => [
    ...(s.tests || []),
    ...collectTests(s.suites || []),
  ]);
}

describe('syncs web assets on the Sauce VM', function () {
  beforeAll(async function () {
    fs.rmSync(assetsDir, { recursive: true, force: true });
    fs.rmSync(path.join(cwd, 'test-results'), { recursive: true, force: true });
    fs.rmSync(reportFile, { force: true });

    output = await new Promise((resolve) => {
      exec(
        'npx playwright test',
        {
          cwd,
          env: {
            PATH: process.env.PATH,
            SAUCE_VIDEO_START_TIME: new Date().toISOString(),
          },
        },
        (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`),
      );
    });

    if (fs.existsSync(reportFile)) {
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
      tests = collectTests(report.suites);
    }
  });

  test('reporter does not fail', function () {
    expect(output).not.toMatch(
      /Error in reporter|ENOENT|Unhandled 'error'|Failed to sync asset/,
    );
  });

  test('sauce report is written with video timestamps', function () {
    expect(fs.existsSync(reportFile)).toBe(true);
    expect(tests).toHaveLength(8);
    for (const t of tests) {
      expect(typeof t.videoTimestamp).toBe('number');
    }
  });

  test('every attachment exists as a unique, safe asset', function () {
    const names = tests.flatMap((t) =>
      (t.attachments || []).map((a) => a.path),
    );
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).not.toMatch(unsafeChars);
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255);
      expect(fs.existsSync(path.join(assetsDir, name))).toBe(true);
    }
  });

  test('safe titles keep their original asset name', function () {
    const control = tests.find((t) => t.name === 'plays video');
    expect(control.attachments).toHaveLength(1);
    expect(control.attachments[0].path).toMatch(
      /^plays video-shot-png-[0-9a-f]{40}\.png$/,
    );
  });

  test('missing attachments are skipped', function () {
    const removed = tests.find((t) => t.name === 'attachment removed later');
    expect(removed.attachments || []).toHaveLength(0);
    expect(output).toMatch(/Skipping attachment "shot.png": file not found/);
  });
});
