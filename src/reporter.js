// reporter.js
// @ts-check

const fs = require('fs');
const { readFile } = require('fs/promises');
const path = require('path');
const SauceLabs = require('saucelabs').default;

const { TestRun, Suite, Status } = require('@saucelabs/sauce-json-reporter');

class MyReporter {
  constructor (config) {
    this.jobUrls = [];

    this.projects = {};
    this.rootProject = undefined;
    this.playwrightVersion = undefined;

    this.buildName = config?.buildName;
    this.tags = config?.tags || [];
    this.region = config?.region || 'us-west-1';
    this.tld = this.region === 'staging' ? 'net' : 'com';
  }

  onBegin (config, suite) {
    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      reporterVersion = packageData.version;
    // eslint-disable-next-line no-empty
    } catch (e) {}

    this.playwrightVersion = config.version || 'unknown';

    this.api = new SauceLabs({
      user: process.env.SAUCE_USERNAME,
      key: process.env.SAUCE_ACCESS_KEY,
      region: this.region,
      tld: this.tld,
      headers: {'User-Agent': `playwright-reporter/${reporterVersion}`},
    });

    this.rootProject = suite;

    for (const cfg of config.projects) {
      this.projects[cfg.name] = cfg;
    }
  }

  onTestBegin (test) {
    test.startedAt = new Date();
  }

  onTestEnd (test) {
    test.endedAt = new Date();
  }

  async onEnd () {
    for (const project of this.rootProject.suites) {
      for (const file of project.suites) {
        await this.reportFile(project, file);
      }
    }
    this.displayReportedJobs(this.jobUrls);

  }

  displayReportedJobs (jobs) {
    console.log(`\nReported jobs to Sauce Labs:`);
    for (const job of jobs) {
      console.log(`  - ${job.url}`);
    }
    console.log();
  }

  contructLogFile (project, file) {
    let consoleLog = `Project: ${project.title}\nFile: ${file.title}\n\n`;

    consoleLog = consoleLog.concat(
      this.formatTestCasesResults(file.tests, '')
    );

    for (const suite of file.suites) {
      consoleLog = consoleLog.concat(
        this.formatSuiteResult(suite)
      );
    }
    return consoleLog;
  }

  constructSauceReport () {
    const report = new TestRun();
    for (const project of this.rootProject.suites) {
      const suite = this.constructSauceSuite(project);

      report.addSuite(suite);
    }

    return report;
  }

  constructSauceSuite (playwrightSuite) {
    const suite = new Suite(playwrightSuite.title);

    for (const testCase of playwrightSuite.tests) {
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
        test.metadata = {
          runs: testCase.results?.length || 0,
        };
      }
    }

    // TODO: Add report metadata
    // 1. framework: playwright
    // 2. reporterVersion: thisVersion,
    // 3. frameworkVersion

    for (const subSuite of playwrightSuite.suites) {
      const s = this.constructSauceSuite(subSuite);

      suite.addSuite(s);
    }

    return suite;
  }

  async reportFile(project, file) {

    // Select project configuration and default to first available project.
    // Playwright version >= 1.16.3 will contain the project config directly.
    const projectConfig = project.project || this.projects[project.title] || this.projects[Object.keys(this.projects)[0]];

    const consoleLog = this.contructLogFile(project, file);

    const sauceReport = new TestRun();
    sauceReport.addSuite(this.constructSauceSuite(file));

    // console.log(sauceReport.stringify());

    // Screenshot / Video management
    const assets = this.getVideosAndScreenshots(file);

    // Global info
    const startedAt = this.findFirstStartedAt(file) || new Date();
    const endedAt = this.findLastEndedAt(file) || new Date();
    const passed = this.hasPassed(file);

    const suiteName = project.title ? `${project.title} - ${file.title}` : `${file.title}`;
    const jobBody = this.createBody({
      browserName: projectConfig?.use?.browserName || 'chromium',
      browserVersion: '1.0',
      build: this.buildName,
      startedAt: startedAt?.toISOString(),
      endedAt: endedAt?.toISOString(),
      success: passed,
      suiteName: suiteName,
      tags: this.tags || [],
      playwrightVersion: this.playwrightVersion,
    });
    const sessionID = await this.createJob(jobBody);
    await this.uploadAssets(sessionID, consoleLog, sauceReport, assets.videos, assets.screenshots);

    this.jobUrls.push({
      url: this.getJobUrl(sessionID, this.region, this.tld),
      name: suiteName,
    });
  }

  findFirstStartedAt (suite) {
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

  findLastEndedAt (suite) {
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

  hasPassed (suite) {
    for (const testCase of suite.tests) {
      const result = testCase.results.map(x => x.status).filter(x => x == 'passed' ).length > 0;
      if (!result) {
        return false;
      }
    }
    for (const subSuite of suite.suites) {
      if (!this.hasPassed(subSuite)) {
        return false;
      }
    }
    return true;
  }

  formatSuiteResult(suite, level = 0) {
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

  formatTestCasesResults(testCases, padding) {
    let consoleLog = '';
    for (const testCase of testCases) {
      const ico = testCase.results.map(x => x.status).filter(x => x == 'passed' ).length > 0 ? '✓' : '✗';
      consoleLog = consoleLog.concat(`${padding}${ico} ${testCase.title}\n`);
    }
    return consoleLog;
  }

  getVideosAndScreenshots(suite) {
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

  async uploadAssets (sessionId, consoleLog, sauceReport, videosPath = [], screenshots = []) {
    const assets = [];

    assets.push({
      filename: 'console.log',
      data: consoleLog
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
      this.api.uploadJobAssets(sessionId, { files: assets }).then(
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
    await this.api.createJob(body).then(
      (resp) => this.sessionId = resp.ID,
      (err) => console.error('Create job failed: ', err)
    );
    return this.sessionId;
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

module.exports = MyReporter;
