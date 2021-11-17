import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  reporter: [
    ['@saucelabs/playwright-reporter', {
      region: 'us-west-1',
      buildName: 'Playwright Integration Tests',
      tags: [
        'playwright',
        'demo',
        'e2e'
      ],
    }],
    ['line'],
  ],
  testDir: 'tests',
  projects: [{
    name: 'Passing Suites',
    use: {
      browserName: 'chromium',

    },
    testMatch: "tests/nesting.example.test.js",
  },
  {
    name: "Project with assets",
    testMatch: 'tests/simple.test.js',
    use: {
      video: 'on',
    },
  },
  {
    name: 'Failing Suites',
    testMatch: 'tests/failing.test.js',
  }
  ],
};

module.exports = config;
