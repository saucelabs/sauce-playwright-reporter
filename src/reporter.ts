import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as stream from 'stream';
import {
  TestRun,
  Suite as SauceSuite,
  Status,
  TestCode,
} from '@saucelabs/sauce-json-reporter';
import {
  Reporter,
  FullConfig,
  Suite as PlaywrightSuite,
  TestCase,
  TestError,
} from '@playwright/test/reporter';

import { Asset, Region, TestComposer } from '@saucelabs/testcomposer';
import { getLines } from './code';
import {
  TestRuns as TestRunsApi,
  TestRunError,
  TestRunRequestBody,
} from './api';
import { CI, IS_CI } from './ci';

export interface Config {
  buildName?: string;
  tags?: string[];
  region?: Region;
  tld?: string;
  outputFile?: string;
  upload?: boolean;
  syncAssetsDir: string;
}

const syncAssetsTypes = [
  '.log',
  '.json',
  '.xml',
  '.mp4',
  '.webm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
];

export default class SauceReporter implements Reporter {
  projects: { [k: string]: any };

  buildName: string;
  tags: string[];
  region: Region;
  outputFile?: string;
  shouldUpload: boolean;
  syncAssetsDir?: string;

  api?: TestComposer;
  testRunsApi?: TestRunsApi;

  rootSuite?: PlaywrightSuite;

  playwrightVersion: string;

  startedAt?: Date;
  endedAt?: Date;

  videoStartTime?: number;

  constructor(reporterConfig: Config) {
    this.projects = {};

    this.buildName = reporterConfig?.buildName || '';
    this.tags = reporterConfig?.tags || [];
    this.region = reporterConfig?.region || 'us-west-1';
    this.outputFile =
      reporterConfig?.outputFile || process.env.SAUCE_REPORT_OUTPUT_NAME;
    this.shouldUpload = reporterConfig?.upload !== false;

    this.syncAssetsDir =
      reporterConfig.syncAssetsDir || process.env.SAUCE_ASSETS_DIR;
    if (this.syncAssetsDir && !fs.existsSync(this.syncAssetsDir)) {
      fs.mkdirSync(this.syncAssetsDir, { recursive: true });
    }

    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
      );
      reporterVersion = packageData.version;
    } catch (e) {
      /* empty */
    }

    if (
      process.env.SAUCE_USERNAME &&
      process.env.SAUCE_USERNAME !== '' &&
      process.env.SAUCE_ACCESS_KEY &&
      process.env.SAUCE_ACCESS_KEY !== ''
    ) {
      this.api = new TestComposer({
        region: this.region,
        username: process.env.SAUCE_USERNAME,
        accessKey: process.env.SAUCE_ACCESS_KEY,
        headers: {
          'User-Agent': `playwright-reporter/${reporterVersion}`,
        },
      });
      this.testRunsApi = new TestRunsApi({
        region: this.region,
        username: process.env.SAUCE_USERNAME,
        accessKey: process.env.SAUCE_ACCESS_KEY,
      });
    }

    this.playwrightVersion = 'unknown';

    if (process.env.SAUCE_VIDEO_START_TIME) {
      this.videoStartTime = new Date(
        process.env.SAUCE_VIDEO_START_TIME,
      ).getTime();
    }
  }

  onBegin(config: FullConfig, suite: PlaywrightSuite) {
    this.startedAt = new Date();

    if (config.version) {
      this.playwrightVersion = config.version;
    }

    this.rootSuite = suite;

    for (const cfg of config.projects) {
      this.projects[cfg.name] = cfg;
    }
  }

  async onEnd() {
    if (!this.rootSuite) {
      return;
    }

    this.endedAt = new Date();

    const jobUrls = [];
    const suites = [];
    for await (const projectSuite of this.rootSuite.suites) {
      const { report, assets } = this.createSauceReport(projectSuite);

      const result = await this.reportToSauce(projectSuite, report, assets);

      if (result?.id) {
        jobUrls.push({
          url: result.url,
          name: projectSuite.title,
        });
        try {
          await this.reportTestRun(projectSuite, report, result?.id);
        } catch (e: any) {
          console.warn('failed to send report to insights, ', e.stack());
        }
      }

      suites.push(...report.suites);

      if (this.isSyncAssetEnabled()) {
        this.syncAssets(assets);
      }
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

  async reportTestRun(
    projectSuite: PlaywrightSuite,
    report: TestRun,
    jobId: string,
  ) {
    const req: TestRunRequestBody = {
      name: projectSuite.title,
      start_time: this.startedAt?.toISOString() || '',
      end_time: this.endedAt?.toISOString() || '',
      duration: this.getDuration(projectSuite),
      platform: 'other',
      type: 'web',
      framework: 'playwright',
      status: report.computeStatus(),
      errors: this.findErrors(projectSuite),
      sauce_job: {
        id: jobId,
        name: projectSuite.title,
      },
      browser: `playwright-${this.getBrowserName(projectSuite)}`,
      tags: this.tags,
      build_name: this.buildName,
      os: this.getPlatformName(),
    };
    if (IS_CI) {
      req.ci = {
        ref_name: CI.refName,
        commit_sha: CI.sha,
        repository: CI.repo,
        branch: CI.refName,
      };
    }

    await this.testRunsApi?.create([req]);
  }

  getDuration(projectSuite: PlaywrightSuite) {
    let duration = 0;
    for (const suite of projectSuite.suites) {
      suite.tests.forEach((t: TestCase) => {
        const lastResult = t.results[t.results.length - 1];
        duration += lastResult.duration;
      });
    }
    return duration;
  }

  findErrors(projectSuite: PlaywrightSuite) {
    const errors: TestRunError[] = [];
    for (const suite of projectSuite.suites) {
      suite.tests.forEach((t: TestCase) => {
        const lastResult = t.results[t.results.length - 1];
        if (lastResult.error) {
          errors.push(lastResult.error);
        }
      });
    }
    return errors;
  }

  getBrowserName(projectSuite: PlaywrightSuite) {
    // Select project configuration and default to first available project.
    // Playwright version >= 1.16.3 will contain the project config directly.
    const projectConfig =
      projectSuite.project() ||
      this.projects[projectSuite.title] ||
      this.projects[Object.keys(this.projects)[0]];

    return (projectConfig?.use?.browserName as string) ?? 'chromium';
  }

  displayReportedJobs(jobs: { name: string; url: string }[]) {
    if (jobs.length < 1) {
      let msg = '';
      const hasCredentials =
        process.env.SAUCE_USERNAME &&
        process.env.SAUCE_USERNAME !== '' &&
        process.env.SAUCE_ACCESS_KEY &&
        process.env.SAUCE_ACCESS_KEY !== '';
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

  constructLogFile(projectSuite: PlaywrightSuite) {
    let consoleLog = `Project: ${projectSuite.title}\n`;
    for (const fileSuite of projectSuite.suites) {
      consoleLog = `${consoleLog}\nFile: ${fileSuite.title}\n\n`;
      consoleLog = consoleLog.concat(
        this.formatTestCasesResults(fileSuite.tests, ''),
      );

      for (const suite of fileSuite.suites) {
        consoleLog = consoleLog.concat(this.formatSuiteResults(suite));
      }
    }

    return consoleLog;
  }

  formatSuiteResults(suite: PlaywrightSuite, level = 0) {
    const padding = '  '.repeat(level);

    let consoleLog = `\n${padding}${suite.title}:\n`;

    consoleLog = consoleLog.concat(
      this.formatTestCasesResults(suite.tests, padding),
    );

    for (const subSuite of suite.suites) {
      consoleLog = consoleLog.concat(
        this.formatSuiteResults(subSuite, level + 1),
      );
    }
    return consoleLog;
  }

  formatTestCasesResults(testCases: TestCase[], padding: string) {
    let consoleLog = '';
    for (const testCase of testCases) {
      const icon =
        testCase.results.filter((r) => r.status === 'passed').length > 0
          ? '✓'
          : '✗';
      consoleLog = consoleLog.concat(`${padding}${icon} ${testCase.title}\n`);
    }
    return consoleLog;
  }

  constructSauceSuite(rootSuite: PlaywrightSuite) {
    const suite = new SauceSuite(rootSuite.title);
    const assets: Asset[] = [];

    for (const testCase of rootSuite.tests) {
      const lastResult = testCase.results[testCase.results.length - 1];

      // TestCase can have 0 results if it was skipped with the skip annotation or
      // if it was filtered with the grep cli flag
      if (!lastResult) {
        break;
      }

      const lines = getLines(testCase);

      const isSkipped = testCase.outcome() === 'skipped';
      const test = suite.withTest(testCase.title, {
        status: isSkipped
          ? Status.Skipped
          : testCase.ok()
          ? Status.Passed
          : Status.Failed,
        duration: lastResult.duration,
        output: lastResult.error
          ? this.errorToMessage(lastResult.error)
          : undefined,
        startTime: lastResult.startTime,
        code: new TestCode(lines),
      });
      if (this.videoStartTime) {
        test.videoTimestamp =
          (lastResult.startTime.getTime() - this.videoStartTime) / 1000;
      }
      if (testCase.id) {
        test.metadata = {
          id: testCase.id,
        };
      }

      for (const attachment of lastResult.attachments) {
        if (!attachment.path && !attachment.body) {
          break;
        }

        const filename = this.resolveAssetName(
          test.name,
          path.basename(attachment.path || ''),
        );
        test.attach({
          name: attachment.name,
          path: filename,
          contentType: attachment.contentType,
        });

        if (attachment.path) {
          assets.push({
            filename,
            path: attachment.path,
            data: fs.createReadStream(attachment.path),
          });
        } else if (attachment.body) {
          assets.push({
            filename: attachment.name,
            data: stream.Readable.from(attachment.body),
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

  createSauceReport(rootSuite: PlaywrightSuite) {
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

  async reportToSauce(
    projectSuite: PlaywrightSuite,
    report: TestRun,
    assets: Asset[],
  ): Promise<{ id: string; url: string } | undefined> {
    const consoleLog = this.constructLogFile(projectSuite);
    const didSuitePass = report.computeStatus() === Status.Passed;

    // Currently no reliable way to get the browser version
    const browserVersion = '1.0';
    const browserName = this.getBrowserName(projectSuite);

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

  async uploadAssets(
    sessionId: string,
    consoleLog: string,
    report: TestRun,
    assets: Asset[],
  ) {
    const logStream = new stream.Readable();
    logStream.push(consoleLog);
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
        const errors = resp?.errors;
        for (const err of errors) {
          console.error('Failed to upload asset:', err);
        }
      }
    } catch (e) {
      console.error('Failed to upload assets:', e);
    }
  }

  getPlatformName() {
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

  // Check if syncAsset is enabled.
  isSyncAssetEnabled(): boolean {
    return !!this.syncAssetsDir;
  }

  // Checks if the file type of a given filename is among the types allowed for syncing.
  isAssetTypeSyncable(filename: string): boolean {
    return syncAssetsTypes.includes(path.extname(filename));
  }

  /**
   * Resolves the name of an asset file by prefixing it with the test name,
   * under the condition that the asset filename is provided,
   * the sync asset feature is enabled, and the asset type is syncable.
   *
   * @param {string} testName The name of the test associated with the asset.
   * @param {string} filename The original filename of the asset.
   * @returns {string} The resolved asset name, prefixed with the test name if all conditions are met;
   * otherwise, returns the original filename.
   */
  resolveAssetName(testName: string, filename: string): string {
    if (
      !filename ||
      !this.isSyncAssetEnabled() ||
      !this.isAssetTypeSyncable(filename)
    ) {
      return filename;
    }
    return `${testName}-${filename}`;
  }

  syncAssets(assets: Asset[]) {
    assets.forEach((asset) => {
      if (this.isAssetTypeSyncable(asset.filename) && asset.path) {
        fs.copyFileSync(
          asset.path,
          path.join(this.syncAssetsDir, asset.filename),
        );
      }
    });
  }
}
