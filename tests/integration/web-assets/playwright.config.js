// Runs the reporter the way the Sauce VM does: no upload, local report file
// and web assets synced into an assets directory.
module.exports = {
  testDir: 'tests',
  outputDir: 'test-results',
  reporter: [
    [
      '../../../lib/reporter.js',
      {
        upload: false,
        outputFile: 'sauce-test-report.json',
        webAssetsDir: '__assets__',
      },
    ],
  ],
};
