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
  use: {
    video: 'on',
  },
  projects: [{
    name: 'Chromium Suite',
    use: {
      browserName: 'chromium',
    },
  }],
};

module.exports = config;
