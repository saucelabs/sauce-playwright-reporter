import fs from 'fs';
import { readFile } from 'fs/promises';
import * as path from 'path';
import SauceLabs from 'saucelabs';
import { TestRun, Suite as SauceSuite, Status } from '@saucelabs/sauce-json-reporter';
import { Reporter, FullConfig, Suite as PlaywrightSuite, TestCase } from '@playwright/test/reporter';

type SauceRegion = 'us' | 'eu' | 'apac' | 'us-west-1' | 'us-east-1' | 'eu-central-1' | 'apac-southeast-1' | 'staging';

type JobUrl = {
  name: string;
  url: string;
};

type Config = {
  buildName?: string;
  tags?: string[];
  region?: SauceRegion;
  tld?: string;
};

export default class SauceReporter implements Reporter {
  jobUrls: JobUrl[];
  projects: { [k: string] : any };

  buildName: string;
  tags: string[];
  region: SauceRegion;
  tld: string;

  api?: SauceLabs;

  rootSuite?: PlaywrightSuite;

  playwrightVersion?: string;
  reporterVersion?: string;

  startedAt?: Date;
  endedAt?: Date;

  constructor (reporterConfig: Config) {
    this.jobUrls = [];
    this.projects = {};

    this.buildName = reporterConfig?.buildName || '';
    this.tags = reporterConfig?.tags || [];
    this.region = reporterConfig?.region || 'us-west-1';
    this.tld = this.region === 'staging' ? 'net' : 'com';

    // TODO: Handle case where creds are not given
  }

  onBegin (config: FullConfig, suite: PlaywrightSuite) {
    this.startedAt = new Date();

    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      this.reporterVersion = packageData.version;
    // eslint-disable-next-line no-empty
    } catch (e) {}

    this.playwrightVersion = config.version || 'unknown';

    this.api = new SauceLabs({
      user: process.env.SAUCE_USERNAME,
      key: process.env.SAUCE_ACCESS_KEY,
      region: this.region,
      tld: this.tld,
      headers: {
        'User-Agent': `playwright-reporter/${this.reporterVersion || 'unknown'}`
      },
    });

    this.rootSuite = suite;

    for (const cfg of config.projects) {
      this.projects[cfg.name] = cfg;
    }
  }

  onTestBegin (test: TestCase) {
    test.startedAt = new Date();
  }

  onTestEnd (test: TestCase) {
    test.endedAt = new Date();
  }

  async onEnd () {
    if (!this.rootSuite) {
      return;
    }

    this.endedAt = new Date();

    for (const projectSuite of this.rootSuite.suites) {
      for (const fileSuite of projectSuite.suites) {
        await this.reportFile(projectSuite, fileSuite);
      }
    }
    this.displayReportedJobs(this.jobUrls);
  }

  displayReportedJobs (jobs: JobUrl[]) {
    console.log(`\nReported jobs to Sauce Labs:`);
    for (const job of jobs) {
      console.log(`  - ${job.url}`);
    }
    console.log();
  }

  constructLogFile (projectSuite: PlaywrightSuite, fileSuite: PlaywrightSuite) {
    let consoleLog = `Project: ${projectSuite.title}\nFile: ${fileSuite.title}\n\n`;

    consoleLog = consoleLog.concat(
      this.formatTestCasesResults(fileSuite.tests, '')
    );

    for (const suite of fileSuite.suites) {
      consoleLog = consoleLog.concat(
        this.formatSuiteResult(suite)
      );
    }
    return consoleLog;
  }

  constructSauceReport (rootSuite: PlaywrightSuite) {
    const report = new TestRun();
    for (const project of rootSuite.suites) {
      const suite = this.constructSauceSuite(project);

      report.addSuite(suite);
    }

    return report;
  }

  constructSauceSuite (rootSuite: PlaywrightSuite) {
    const suite = new SauceSuite(rootSuite.title);

    for (const testCase of rootSuite.tests) {
      const test = suite.withTest(
        testCase.title,
        testCase.ok() ? Status.Passed : Status.Failed,
        testCase.results.map((r) => r.duration).reduce((prev, curr) => { return prev + curr }, 0),
      );

      // Add test case metadata
      // {
      //    "results": [
      //      {
      //        status,
      //        error,
      //        sourceSnippet,  Need to compute it
      //        retry,
      //        attachments,
      //      },
      //    ],
      if (testCase.results?.length > 0) {
        const result = testCase.results[0];
        // TODO: Handle multiple results (i.e. when a test was retried)
        for (const attachment of result.attachments) {
          if (attachment.path) {
            test.attach({
              name: attachment.name,
              path: attachment.path,
              contentType: attachment.contentType,
            });
          }
        }

        test.startTime = result.startTime;

        // TODO: Need parity with junit
        test.metadata = {
          runs: testCase.results?.length || 0,
        };
      }
    }

    // TODO: Add report metadata
    // 1. framework: playwright
    // 2. reporterVersion: thisVersion,
    // 3. frameworkVersion

    for (const subSuite of rootSuite.suites) {
      const s = this.constructSauceSuite(subSuite);

      suite.addSuite(s);
    }

    return suite;
  }

  async reportFile(projectSuite: PlaywrightSuite, fileSuite: PlaywrightSuite) {
    // Select project configuration and default to first available project.
    // Playwright version >= 1.16.3 will contain the project config directly.
    const projectConfig = projectSuite.project ||
      this.projects[projectSuite.title] ||
      this.projects[Object.keys(this.projects)[0]];

    const consoleLog = this.constructLogFile(projectSuite, fileSuite);

    const sauceReport = new TestRun();
    sauceReport.addSuite(this.constructSauceSuite(fileSuite));

    // Screenshot / Video management
    const assets = this.getVideosAndScreenshots(fileSuite);

    // Global info
    const startedAt = this.findFirstStartedAt(fileSuite) || new Date();
    const endedAt = this.findLastEndedAt(fileSuite) || new Date();
    const passed = sauceReport.computeStatus() === Status.Passed;

    const suiteName = projectSuite.title ? `${projectSuite.title} - ${fileSuite.title}` : `${fileSuite.title}`;
    const jobBody = this.createBody({
      // TODO: Can we get browser name if no projects are defined?
      browserName: projectConfig?.use?.browserName || 'chromium',
      browserVersion: '1.0',
      build: this.buildName,
      startedAt: startedAt?.toISOString(),
      endedAt: endedAt?.toISOString(),
      success: passed,
      suiteName: suiteName,
      tags: this.tags,
      playwrightVersion: this.playwrightVersion,
    });
    const sessionID = await this.createJob(jobBody);
    await this.uploadAssets(sessionID, consoleLog, sauceReport, assets.videos, assets.screenshots);

    this.jobUrls.push({
      url: this.getJobUrl(sessionID, this.region, this.tld),
      name: suiteName,
    });
  }

  findFirstStartedAt (suite: PlaywrightSuite): Date {
    let minDate;
    for (const test of suite.tests) {
      if (!minDate || test.startedAt < minDate) {
        minDate = test.startedAt;
      }
    }
    for (const subSuite of suite.suites) {
      const subMinDate = this.findFirstStartedAt(subSuite);
      if (!minDate || subMinDate < minDate) {
        minDate = subMinDate;
      }
    }
    return minDate;
  }

  findLastEndedAt (suite: PlaywrightSuite): Date{
    let maxDate;
    for (const test of suite.tests) {
      if (!maxDate || test.startedAt < maxDate) {
        maxDate = test.startedAt;
      }
    }
    for (const subSuite of suite.suites) {
      const subMaxDate = this.findLastEndedAt(subSuite);
      if (!maxDate || maxDate < subMaxDate) {
        maxDate = subMaxDate;
      }
    }
    return maxDate;
  }

  formatSuiteResult(suite: PlaywrightSuite, level = 0) {
    const padding = '  '.repeat(level);

    let consoleLog = `\n${padding}${suite.title}:\n`

    consoleLog = consoleLog.concat(
      this.formatTestCasesResults(suite.tests, padding)
    );

    for (const subSuite of suite.suites) {
      consoleLog = consoleLog.concat(
        this.formatSuiteResult(subSuite, level+1)
      );
    }
    return consoleLog;
  }

  formatTestCasesResults(testCases: TestCase[], padding: string) {
    let consoleLog = '';
    for (const testCase of testCases) {
      const ico = testCase.results.map(x => x.status).filter(x => x == 'passed' ).length > 0 ? '✓' : '✗';
      consoleLog = consoleLog.concat(`${padding}${ico} ${testCase.title}\n`);
    }
    return consoleLog;
  }

  getVideosAndScreenshots(suite: PlaywrightSuite) {
    const assets = { videos: [], screenshots: [] };

    for (const testCase of suite.tests) {
      for (const result of testCase.results) {
        for (const attachment of result.attachments) {
          if (attachment.name === 'video') {
            assets.videos.push(attachment.path);
          } else {
            assets.screenshots.push(attachment.path);
          }
        }
      }
    }

    for (const subSuite of suite.suites) {
      const { videos: subVideos, screenshots: subScreenshots } = this.getVideosAndScreenshots(subSuite);
      assets.videos.push(...subVideos);
      assets.screenshots.push(...subScreenshots);
    }

    return assets;
  }

  async uploadAssets (sessionId: string, consoleLog: string, sauceReport: TestRun, videosPath = [], screenshots = []) {
    const assets = [];

    assets.push({
      filename: 'console.log',
      data: Buffer.from(consoleLog),
    });

    assets.push({
      filename: 'sauce-test-report.json',
      data: Buffer.from(sauceReport.stringify()),
    });

    if (videosPath.length > 1) {
      assets.push(...videosPath);
      try {
        const videoData = await readFile(videosPath[0]);
        assets.push({
          filename: 'video.webm',
          data: videoData,
        });
      } catch (e) {
        console.log(`@saucelabs/cypress-plugin: unable to report video file ${videosPath[0]}: ${e}`);
      }
    }
    assets.push(...screenshots);

    await Promise.all([
      this.api?.uploadJobAssets(sessionId, { files: assets }).then(
        (resp) => {
          // console.log(resp);
          if (resp.errors) {
            for (let err of resp.errors) {
              console.error(err);
            }
          }
        },
        (e) => console.log('Upload failed:', e.stack)
      )
    ]);
  }

  async createJob (body) {
    try {
      const resp = await this.api?.createJob(body);

      return resp.ID;
    } catch (e) {
      console.error('Create job failed: ', e);
    }
  }

  createBody ({
    suiteName,
    startedAt,
    endedAt,
    success,
    tags,
    build,
    browserName,
    browserVersion,
    playwrightVersion,
  }) {

    return {
      name: suiteName,
      user: process.env.SAUCE_USERNAME,
      startTime: startedAt,
      endTime: endedAt,
      framework: 'playwright',
      frameworkVersion: playwrightVersion,
      status: 'complete',
      suite: suiteName,
      errors: [], // To Add
      passed: success,
      tags: tags,
      build: build,
      browserName,
      browserVersion,
      platformName: this.getOsName(),
    };
  }

  getOsName () {
    switch (process.platform) {
      case 'darwin':
        return 'mac';
      case 'win32':
        return 'windows';
      case 'linux':
        return 'linux';
      default:
        'unknown';
    }
  }

  getJobUrl (sessionId, region, tld) {
    if (region === 'us-west-1') {
      return `https://app.saucelabs.com/tests/${sessionId}`
    }
    return `https://app.${region}.saucelabs.${tld}/tests/${sessionId}`;
  }
}
