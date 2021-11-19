import fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import os from 'os';
import SauceLabs from 'saucelabs';
import { TestRun, Suite as SauceSuite, Status } from '@saucelabs/sauce-json-reporter';
import { Reporter, FullConfig, Suite as PlaywrightSuite, TestCase, TestError } from '@playwright/test/reporter';

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
  outputFile?: string;
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

type Asset = {
  filename: string;
  data: Buffer;
};

export default class SauceReporter implements Reporter {
  projects: { [k: string] : any };

  buildName: string;
  tags: string[];
  region: SauceRegion;
  outputFile?: string;

  api?: SauceLabs;

  rootSuite?: PlaywrightSuite;

  playwrightVersion: string;

  startedAt?: Date;
  endedAt?: Date;

  constructor (reporterConfig: Config) {
    this.projects = {};

    this.buildName = reporterConfig?.buildName || '';
    this.tags = reporterConfig?.tags || [];
    this.region = reporterConfig?.region || 'us-west-1';
    this.outputFile = reporterConfig.outputFile;

    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      reporterVersion = packageData.version;
    // eslint-disable-next-line no-empty
    } catch (e) {}

    if (process.env.SAUCE_USERNAME && process.env.SAUCE_USERNAME !== '' && process.env.SAUCE_ACCESS_KEY && process.env.SAUCE_ACCESS_KEY !== '') {
      this.api = new SauceLabs({
        user: process.env.SAUCE_USERNAME,
        key: process.env.SAUCE_ACCESS_KEY,
        region: this.region,
        tld: this.region === 'staging' ? 'net' : 'com',
        headers: {
          'User-Agent': `playwright-reporter/${reporterVersion}`
        },
      });
    } else {
      console.warn('$SAUCE_USERNAME and $SAUCE_ACCESS_KEY environment variables must be defined in order for reports to be uploaded to SauceLabs');
    }

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
    const suites = [];
    for (const projectSuite of this.rootSuite.suites) {
      const { report, assets } = this.createSauceReport(projectSuite);

      const id = await this.reportToSauce(projectSuite, report, assets);

      if (id) {
        jobUrls.push({
          url: this.getJobUrl(id, this.region),
          name: projectSuite.title,
        });
      }

      suites.push(...report.suites);
    }

    this.displayReportedJobs(jobUrls);

    if (this.outputFile) {
      const report = new TestRun();
      for (const s of suites) {
        report.addSuite(s);
      }
      this.reportToFile(report);
    }
  }

  displayReportedJobs (jobs: JobUrl[]) {
    if (jobs.length < 1) {
      return;
    }

    console.log(`\nReported jobs to Sauce Labs:`);
    for (const job of jobs) {
      console.log(`  - ${job.name}: ${job.url}`);
    }

    // NOTE: This empty console.log() is required for the output
    // to work with the line reporter. The line reporter makes liberal
    // use of the erase line ansi escape code. The empty console.log here
    // is a buffer between our output and a possible erase escape.
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
      const icon = testCase.results.filter((r) => r.status === 'passed').length > 0 ? '✓' : '✗';
      consoleLog = consoleLog.concat(`${padding}${icon} ${testCase.title}\n`);
    }
    return consoleLog;
  }

  constructSauceSuite (rootSuite: PlaywrightSuite) : { suite: SauceSuite, assets : Asset[]} {
    const suite = new SauceSuite(rootSuite.title);
    const assets : Asset[] = [];

    for (const testCase of rootSuite.tests) {
      const lastResult = testCase.results[testCase.results.length - 1];

      // TestCase can have 0 results if it was skipped with the skip annotation or
      // if it was filtered with the grep cli flag
      if (!lastResult) {
        break;
      }

      const isSkipped = testCase.outcome() === 'skipped';
      const test = suite.withTest(
        testCase.title,
        isSkipped ? Status.Skipped : (testCase.ok() ? Status.Passed : Status.Failed),
        lastResult.duration,
        lastResult.error ? this.errorToMessage(lastResult.error) : undefined,
        lastResult.startTime,
      );

      for (const attachment of lastResult.attachments) {
        if (!attachment.path && !attachment.body) {
          break;
        }

        const prefix = randomBytes(16).toString('hex');
        const filename = `${prefix}-${attachment.name}`;

        let data;
        if (attachment.path) {
          try {
            data = fs.readFileSync(attachment.path);
          } catch (e) {
            console.log(`@saucelabs/playwright-reporter: unable to report video file ${attachment.path}: ${e}`);
          }
        } else if (attachment.body) {
          data = attachment.body;
        }

        if (data) {
          test.attach({
            name: attachment.name,
            path: filename,
            contentType: attachment.contentType,
          });

          assets.push({
            filename,
            data,
          });
        }
      }
    }

    for (const subSuite of rootSuite.suites) {
      const { suite: s, assets: a } = this.constructSauceSuite(subSuite);
      suite.addSuite(s);

      assets.push(...a);
    }

    return {
      suite,
      assets,
    };
  }

  errorToMessage(err: TestError) {
    return `${err.message}:  ${err.value}

${err.stack}
    `;
  }

  createSauceReport (rootSuite: PlaywrightSuite) : { report: TestRun, assets: Asset[] } {
    const { suite: sauceSuite, assets } = this.constructSauceSuite(rootSuite);

    const report = new TestRun();
    report.addSuite(sauceSuite);

    return {
      report,
      assets,
    };
  }

  reportToFile(report: TestRun) {
    if (!this.outputFile) {
      return;
    }

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    report.toFile(this.outputFile);
  }

  async reportToSauce(projectSuite: PlaywrightSuite, report: TestRun, assets: Asset[]) {
    // Select project configuration and default to first available project.
    // Playwright version >= 1.16.3 will contain the project config directly.
    const projectConfig = projectSuite.project ||
      this.projects[projectSuite.title] ||
      this.projects[Object.keys(this.projects)[0]];

    const consoleLog = this.constructLogFile(projectSuite);

    const didSuitePass = report.computeStatus() === Status.Passed;

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
    if (sessionID) {
      await this.uploadAssets(sessionID, consoleLog, report, assets);
    }

    return sessionID;
  }

  async uploadAssets (sessionId: string, consoleLog: string, report: TestRun, assets: Asset[]) {
    assets.push({
      filename: 'console.log',
      data: Buffer.from(consoleLog),
    });

    assets.push({
      filename: 'sauce-test-report.json',
      data: Buffer.from(report.stringify()),
    });

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

      return resp?.ID;
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
