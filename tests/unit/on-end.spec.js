require('jest');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Suite, TestRun } = require('@saucelabs/sauce-json-reporter');
const SauceReporter = require('../../lib/reporter.js').default;
const { getLines } = require('../../lib/code.js');

function reportWith(suiteName, attach) {
  const suite = new Suite(suiteName);
  const test = suite.withTest(`${suiteName} test`, {});
  if (attach) {
    test.attach({ name: attach, path: attach, contentType: 'image/png' });
  }
  const report = new TestRun();
  report.addSuite(suite);
  return report;
}

function readReport(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

describe('SauceReporter.onEnd', function () {
  let tmpDir;
  let errorSpy;

  beforeEach(function () {
    delete process.env.SAUCE_USERNAME;
    delete process.env.SAUCE_ACCESS_KEY;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-reporter-'));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(function () {
    errorSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes the report and rethrows when a project fails', async function () {
    const outputFile = path.join(tmpDir, 'sauce-test-report.json');
    const reporter = new SauceReporter({ outputFile });
    reporter.rootSuite = { suites: [{ title: 'broken' }, { title: 'ok' }] };
    reporter.createSauceReport = async (projectSuite) => {
      if (projectSuite.title === 'broken') {
        throw new Error('boom');
      }
      return { report: reportWith('ok'), assets: [] };
    };

    await expect(reporter.onEnd()).rejects.toThrow('boom');

    expect(fs.existsSync(outputFile)).toBe(true);
    expect(readReport(outputFile).suites.map((s) => s.name)).toEqual(['ok']);
  });

  test('drops attachments that failed to sync', async function () {
    const outputFile = path.join(tmpDir, 'sauce-test-report.json');
    const webAssetsDir = path.join(tmpDir, '__assets__');
    const reporter = new SauceReporter({ outputFile, webAssetsDir });
    reporter.rootSuite = { suites: [{ title: 'project' }] };
    reporter.createSauceReport = async () => ({
      report: reportWith('project', 'a.png'),
      assets: [{ filename: 'a.png', path: path.join(tmpDir, 'missing.png') }],
    });

    await expect(reporter.onEnd()).resolves.toBeUndefined();

    const [suite] = readReport(outputFile).suites;
    expect(suite.tests[0].attachments || []).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to sync asset "a.png":',
      // fs errors come from another realm, so match on the code.
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });
});

describe('getLines', function () {
  test('returns no lines when the spec file is missing', function () {
    const testCase = {
      results: [{ steps: [{ location: { line: 1 } }] }],
      location: { file: path.join(os.tmpdir(), 'does-not-exist.spec.js') },
    };
    expect(getLines(testCase)).toEqual([]);
  });
});
