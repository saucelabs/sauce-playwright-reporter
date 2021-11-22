require('jest');

const { exec } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const axios = require('axios');

const jobUrlPattern = /https:\/\/app\.saucelabs\.com\/tests\/([0-9a-f]{32})/g

let hasError;
let output;


describe('runs tests on cloud', function () {
  beforeAll(async function () {
    const playwrightRunCommand = './node_modules/.bin/playwright test';
    // Ignore tests that are known to fail
    const args = '--project "Project with assets"';
    const execOpts = {
      cwd: __dirname,
      env: {
        PATH: process.env.PATH,
        SAUCE_USERNAME: process.env.SAUCE_USERNAME,
        SAUCE_ACCESS_KEY: process.env.SAUCE_ACCESS_KEY,
      },
    };

    const p = new Promise((resolve) => {
      exec(`${playwrightRunCommand} ${args}`, execOpts, async function (err, stdout) {
        hasError = err;
        output = stdout;
        resolve();
      });
    });
    await p;
  });

  test('playwright execution passed', async function () {
    expect(hasError).toBeNull();
  });

  test('jobs link is displayed', function () {
    let jobs = [];
    const jobIDs = output.match(jobUrlPattern);

    for (const job of jobIDs) {
      const idx = job.slice(job.lastIndexOf('/')+1);
      jobs.push(idx);
    }
    expect(jobs.length).toBe(1);
  });

  test('local sauce report exists', async function () {
    expect(existsSync(path.join(__dirname, 'sauce-test-report.json'))).toBe(true);
  });

  test('job has expected assets attached', async function () {
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/')+1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}/assets`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      }
    });
    const assets = response.data;
    expect(assets['console.log']).toBe('console.log');
    expect(assets['sauce-test-report.json']).toBe('sauce-test-report.json');
    expect(Object.keys(assets).some((key) => key.indexOf('video') != -1)).toBe(true);
  });

  test('job has name/tags correctly set', async function () {
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/')+1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      }
    });
    const jobDetails = response.data;

    expect(jobDetails.passed).toBe(true);
    expect(jobDetails.tags.sort()).toEqual(['demo', 'e2e', 'playwright']);
    expect(jobDetails.name).toBe('Project with assets');
  });
});
