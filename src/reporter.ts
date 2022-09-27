import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import * as os from 'os';
import * as stream from "stream";
import { TestRun, Suite as SauceSuite, Status, TestCode } from '@saucelabs/sauce-json-reporter';
import { Reporter, FullConfig, Suite as PlaywrightSuite, TestCase, TestError } from '@playwright/test/reporter';

import { Asset, TestComposer } from './testcomposer';
import { Region } from './region';
import { getLines } from './code';

export interface Config {
  buildName?: string;
  tags?: string[];
  region?: Region;
  tld?: string;
  outputFile?: string;
  upload?: boolean;
}

export default class SauceReporter implements Reporter {
  projects: { [k: string]: any };

  buildName: string;
  tags: string[];
  region: Region;
  outputFile?: string;
  shouldUpload: boolean;

  api?: TestComposer;

  rootSuite?: PlaywrightSuite;

  playwrightVersion: string;

  startedAt?: Date;
  endedAt?: Date;

  videoStartTime?: number;

  constructor(reporterConfig: Config) {
    this.projects = {};

    this.buildName = reporterConfig?.buildName || '';
    this.tags = reporterConfig?.tags || [];
    this.region = reporterConfig?.region || Region.USWest1;
    this.outputFile = reporterConfig?.outputFile || process.env.SAUCE_REPORT_OUTPUT_NAME;
    this.shouldUpload = reporterConfig?.upload !== false;

    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      reporterVersion = packageData.version;
    // eslint-disable-next-line no-empty
    } catch (e) {}

    if (process.env.SAUCE_USERNAME && process.env.SAUCE_USERNAME !== '' && process.env.SAUCE_ACCESS_KEY && process.env.SAUCE_ACCESS_KEY !== '') {
      this.api = new TestComposer({
        region: this.region,
        username: process.env.SAUCE_USERNAME,
        accessKey: process.env.SAUCE_ACCESS_KEY,
        headers: {
          'User-Agent': `playwright-reporter/${reporterVersion}`,
        },
      });
    }

    this.playwrightVersion = 'unknown';

    if (process.env.SAUCE_VIDEO_START_TIME) {
      this.videoStartTime = new Date(process.env.SAUCE_VIDEO_START_TIME).getTime();
    }
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
    for await (const projectSuite of this.rootSuite.suites) {
      const { report, assets } = await this.createSauceReport(projectSuite);

      const result = await this.reportToSauce(projectSuite, report, assets);

      if (result?.id) {
        jobUrls.push({
          url: result.url,
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

  displayReportedJobs (jobs: { name: string, url: string }[]) {
    if (jobs.length < 1) {
      let msg = '';
      const hasCredentials = process.env.SAUCE_USERNAME && process.env.SAUCE_USERNAME !== '' && process.env.SAUCE_ACCESS_KEY && process.env.SAUCE_ACCESS_KEY !== '';
      if (hasCredentials && this.shouldUpload) {
        msg = `\nNo results reported to Sauce. $SAUCE_USERNAME and $SAUCE_ACCESS_KEY environment variables must be defined in order for reports to be uploaded to Sauce.`;
      }
      console.log(msg);
      console.log();
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

  async constructSauceSuite (rootSuite: PlaywrightSuite) {
    const suite = new SauceSuite(rootSuite.title);
    const assets : Asset[] = [];

    for (const testCase of rootSuite.tests) {
      const lastResult = testCase.results[testCase.results.length - 1];

      // TestCase can have 0 results if it was skipped with the skip annotation or
      // if it was filtered with the grep cli flag
      if (!lastResult) {
        break;
      }

      const lines = await getLines(testCase);

      const isSkipped = testCase.outcome() === 'skipped';
      const test = suite.withTest(testCase.title, {
        status: isSkipped ? Status.Skipped : (testCase.ok() ? Status.Passed : Status.Failed),
        duration: lastResult.duration,
        output: lastResult.error ? this.errorToMessage(lastResult.error) : undefined,
        startTime: lastResult.startTime,
        code: new TestCode(lines),
      });
      if (this.videoStartTime) {
        test.videoTimestamp = (lastResult.startTime.getTime() - this.videoStartTime) / 1000;
      }

      for (const attachment of lastResult.attachments) {
        if (!attachment.path && !attachment.body) {
          break;
        }

        const suffix = randomBytes(16).toString('hex');
        let filename = `${attachment.name}-${suffix}`;

        if (path.extname(filename) === '') {
          if (attachment.contentType.endsWith('png')) {
            filename = `${filename}.png`;
          } else if (attachment.contentType.endsWith('webm')) {
            filename= `${filename}.webm`;
          }
        }

        test.attach({
          name: attachment.name,
          path: filename,
          contentType: attachment.contentType,
        });

        if (attachment.path) {
          assets.push({
            filename,
            data: fs.createReadStream(attachment.path),
          });
        } else if (attachment.body) {
          assets.push({
            filename,
            data: fs.createReadStream(attachment.body),
          });
        }
      }
    }

    for await (const subSuite of rootSuite.suites) {
      const { suite: s, assets: a } = await this.constructSauceSuite(subSuite);
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

  async createSauceReport (rootSuite: PlaywrightSuite) {
    const { suite: sauceSuite, assets } = await this.constructSauceSuite(rootSuite);

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

  async reportToSauce(projectSuite: PlaywrightSuite, report: TestRun, assets: Asset[]) : Promise<{ id: string, url: string } | undefined> {
    // Select project configuration and default to first available project.
    // Playwright version >= 1.16.3 will contain the project config directly.
    const projectConfig = projectSuite.project() ||
      this.projects[projectSuite.title] ||
      this.projects[Object.keys(this.projects)[0]];

    const consoleLog = this.constructLogFile(projectSuite);

    const didSuitePass = report.computeStatus() === Status.Passed;

    // Currently no reliable way to get the browser version
    const browserVersion = '1.0';
    const browserName = projectConfig?.use?.browserName as string ?? 'chromium';

    if (this.shouldUpload) {
      const resp = await this.api?.createReport({
        name: projectSuite.title,
        browserName: `playwright-${browserName}`,
        browserVersion,
        platformName: this.getPlatformName(),
        framework: 'playwright',
        frameworkVersion: this.playwrightVersion,
        passed: didSuitePass,
        startTime: this.startedAt?.toISOString() ?? new Date().toISOString(),
        endTime: this.endedAt?.toISOString() ?? new Date().toISOString(),
        build: this.buildName,
        tags: this.tags,
      });
      if (resp?.id) {
        await this.uploadAssets(resp.id, consoleLog, report, assets);
      }
      return resp;
    }
  }

  async uploadAssets (sessionId: string, consoleLog: string, report: TestRun, assets: Asset[]) {
    const logStream = new stream.Readable();
    logStream.push(consoleLog)
    logStream.push(null);
    assets.push({
      filename: 'console.log',
      data: logStream,
    });

    const reportStream = new stream.Readable();
    reportStream.push(report.stringify());
    reportStream.push(null);
    assets.push({
      filename: 'sauce-test-report.json',
      data: reportStream,
    });

    try {
      const resp = await this.api?.uploadAssets(sessionId, assets);
      if (resp?.errors) {
        for (const err of resp?.errors) {
          console.error('Failed to upload asset:', err);
        }
      }
    } catch (e) {
      console.error('Failed to upload assets:', e);
    }
  }

  getPlatformName () {
    switch (os.platform()) {
      case 'darwin':
        return `darwin ${os.release()}`;
      case 'win32':
        return `windows ${os.release()}`;
      case 'linux':
        return 'linux';
      default:
        return 'unknown';
    }
  }
}
