import fs from 'fs';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import os from 'os';
import SauceLabs from 'saucelabs';
import { TestRun, Suite as SauceSuite, Status, Attachment } from '@saucelabs/sauce-json-reporter';
import { Reporter, FullConfig, Suite as PlaywrightSuite, TestCase } from '@playwright/test/reporter';

type SauceRegion = 'us-west-1' | 'eu-central-1' | 'staging';

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

type ReportsRequestBody = {
  name?: string;
  browserName?: string;
  browserVersion?: string;
  platformName?: string;
  framework?: string;
  frameworkVersion?: string;
  passed?: boolean;
  startTime: string;
  endTime: string;
  build?: string;
  tags?: string[];
  suite?: string;
};

export default class SauceReporter implements Reporter {
  jobUrls: JobUrl[];
  projects: { [k: string] : any };

  buildName: string;
  tags: string[];
  region: SauceRegion;

  api: SauceLabs;

  rootSuite?: PlaywrightSuite;

  playwrightVersion: string;

  startedAt?: Date;
  endedAt?: Date;

  constructor (reporterConfig: Config) {
    this.jobUrls = [];
    this.projects = {};

    this.buildName = reporterConfig?.buildName || '';
    this.tags = reporterConfig?.tags || [];
    this.region = reporterConfig?.region || 'us-west-1';

    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      reporterVersion = packageData.version;
    // eslint-disable-next-line no-empty
    } catch (e) {}

    this.api = new SauceLabs({
      user: process.env.SAUCE_USERNAME || '',
      key: process.env.SAUCE_ACCESS_KEY || '',
      region: this.region,
      tld: this.region === 'staging' ? 'net' : 'com',
      headers: {
        'User-Agent': `playwright-reporter/${reporterVersion}`
      },
    });

    this.playwrightVersion = 'unknown';
  }

  onBegin (config: FullConfig, suite: PlaywrightSuite) {
    this.startedAt = new Date();

    if (config.version) {
      this.playwrightVersion = config.version;
    }

    this.rootSuite = suite;

    for (const cfg of config.projects) {
      this.projects[cfg.name] = cfg;
    }
  }

  async onEnd () {
    if (!this.rootSuite) {
      return;
    }

    this.endedAt = new Date();

    const jobUrls = [];
    for (const projectSuite of this.rootSuite.suites) {
      const id = await this.reportProject(projectSuite);
      jobUrls.push({
        url: this.getJobUrl(id, this.region),
        name: projectSuite.title,
      });
    }

    this.displayReportedJobs(jobUrls);
  }

  displayReportedJobs (jobs: JobUrl[]) {
    console.log(`\nReported jobs to Sauce Labs:`);
    for (const job of jobs) {
      console.log(`  - ${job.name}: ${job.url}`);
    }

    // NOTE: This empty console.log() is required for the output
    // to work with the line reporter. The line reporter makes liberal
    // use of the backspace ansi escape code. The empty console.log here
    // is a buffer between our output and a possible backspace escape.
    console.log();
  }

  constructLogFile (projectSuite: PlaywrightSuite) {
    let consoleLog = `Project: ${projectSuite.title}\n`;
    for (const fileSuite of projectSuite.suites) {
      consoleLog = `${consoleLog}\nFile: ${fileSuite.title}\n\n`;
      consoleLog = consoleLog.concat(
        this.formatTestCasesResults(fileSuite.tests, '')
      );

      for (const suite of fileSuite.suites) {
        consoleLog = consoleLog.concat(
          this.formatSuiteResults(suite)
        );
      }
    }

    return consoleLog;
  }

  formatSuiteResults (suite: PlaywrightSuite, level = 0) {
    const padding = '  '.repeat(level);

    let consoleLog = `\n${padding}${suite.title}:\n`

    consoleLog = consoleLog.concat(
      this.formatTestCasesResults(suite.tests, padding)
    );

    for (const subSuite of suite.suites) {
      consoleLog = consoleLog.concat(
        this.formatSuiteResults(subSuite, level+1)
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

  constructSauceSuite (rootSuite: PlaywrightSuite) {
    const suite = new SauceSuite(rootSuite.title);

    for (const testCase of rootSuite.tests) {
      const lastResult = testCase.results[testCase.results.length - 1];

      const isSkipped = testCase.outcome() === 'skipped';
      const test = suite.withTest(
        testCase.title,
        isSkipped ? Status.Skipped : (testCase.ok() ? Status.Passed : Status.Failed),
        lastResult.duration,
      );

      for (const attachment of lastResult.attachments) {
        const name = attachment.path ? path.basename(attachment.path) : attachment.name;
        const prefix = randomBytes(16).toString('hex');
        test.attach({
          name: `${prefix}-${name}`,
          path: attachment.path || '',
          contentType: attachment.contentType,
        });
      }

      test.startTime = lastResult.startTime;
    }

    for (const subSuite of rootSuite.suites) {
      const s = this.constructSauceSuite(subSuite);
      suite.addSuite(s);
    }

    return suite;
  }

  async reportProject(projectSuite: PlaywrightSuite) {
    // Select project configuration and default to first available project.
    // Playwright version >= 1.16.3 will contain the project config directly.
    const projectConfig = projectSuite.project ||
      this.projects[projectSuite.title] ||
      this.projects[Object.keys(this.projects)[0]];

    const consoleLog = this.constructLogFile(projectSuite);

    const sauceSuite = this.constructSauceSuite(projectSuite)
    const attachments = this.findAttachments(sauceSuite);

    const sauceReport = new TestRun();
    sauceReport.addSuite(sauceSuite);

    const didSuitePass = sauceReport.computeStatus() === Status.Passed;

    // Currently no reliable way to get the browser version
    const browserVersion = '1.0';

    const jobBody = this.createBody({
      browserName: projectConfig?.use?.browserName || 'chromium',
      browserVersion,
      build: this.buildName,
      startedAt: this.startedAt ? this.startedAt.toISOString() : new Date().toISOString(),
      endedAt: this.endedAt ? this.endedAt.toISOString() : new Date().toISOString(),
      success: didSuitePass,
      suiteName: projectSuite.title,
      tags: this.tags,
      playwrightVersion: this.playwrightVersion,
    });

    const sessionID = await this.createJob(jobBody);
    await this.uploadAssets(sessionID, consoleLog, sauceReport, attachments);

    return sessionID;
  }

  findAttachments(suite: SauceSuite) : Attachment[] {
    const attachments = [];
    for (const test of suite.tests) {
      if (!test.attachments) {
        break;
      }

      for (const attachment of test.attachments) {
        attachments.push(attachment);
      }
    }
    for (const subSuite of suite.suites) {
      const suiteAttachments = this.findAttachments(subSuite);

      attachments.push(...suiteAttachments);
    }

    return attachments;
  }

  async uploadAssets (sessionId: string, consoleLog: string, sauceReport: TestRun, attachments: Attachment[]) {
    const assets = [];

    assets.push({
      filename: 'console.log',
      data: Buffer.from(consoleLog),
    });

    assets.push({
      filename: 'sauce-test-report.json',
      data: Buffer.from(sauceReport.stringify()),
    });

    for (const attachment of attachments) {
      if (attachment.path === '') {
        break;
      }

      try {
        const data = await readFile(attachment.path);
        assets.push({
          filename: attachment.name,
          data,
        });
      } catch (e) {
        console.log(`@saucelabs/sauce-playwright-reporter: unable to report video file ${attachment.path}: ${e}`);
      }
    }

    await Promise.all([
      this.api?.uploadJobAssets(sessionId, { files: assets }).then(
        (resp) => {
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

  createBody (args: {
    suiteName: string,
    startedAt: string,
    endedAt: string,
    success: boolean,
    tags: string[],
    build: string,
    browserName: string,
    browserVersion: string,
    playwrightVersion: string,
  }) : ReportsRequestBody {

    return {
      name: args.suiteName,
      startTime: args.startedAt,
      endTime: args.endedAt,
      framework: 'playwright',
      frameworkVersion: args.playwrightVersion,
      suite: args.suiteName,
      passed: args.success,
      tags: args.tags,
      build: args.build,
      browserName: args.browserName,
      browserVersion: args.browserVersion,
      platformName: this.getPlatformName(),
    };
  }

  getPlatformName () {
    switch (os.platform()) {
      case 'darwin':
        return `Mac ${os.release()}`;
      case 'win32':
        return `windows ${os.release()}`;
      case 'linux':
        return 'linux';
      default:
        return 'unknown';
    }
  }

  getJobUrl (sessionId: string, region: SauceRegion) {
    const tld = region === 'staging' ? 'net' : 'com';

    if (region === 'us-west-1') {
      return `https://app.saucelabs.com/tests/${sessionId}`
    }
    return `https://app.${region}.saucelabs.${tld}/tests/${sessionId}`;
  }
}
