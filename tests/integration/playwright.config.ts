import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  reporter: [
    [
      '../../lib/reporter.js',
      {
        region: 'us-west-1',
        buildName: 'Playwright Integration Tests',
        tags: ['playwright', 'demo', 'e2e'],
        outputFile: 'sauce-test-report.json',
        mergeVideos: true,
      },
    ],
    ['line'],
  ],
  testDir: 'tests',
  projects: [
    {
      name: 'Passing Suites',
      use: {
        browserName: 'chromium',
      },
      testMatch: 'tests/nesting.example.test.js',
    },
    {
      name: 'Project with assets',
      testMatch: 'tests/simple.test.js',
      use: {
        video: 'on',
      },
    },
    {
      name: 'Failing Suites',
      testMatch: 'tests/failing.test.js',
    },
    {
      name: 'Annotation tests',
      testMatch: 'tests/annotation.test.ts',
    },
  ],
};

export default config;
