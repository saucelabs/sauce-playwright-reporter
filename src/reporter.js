// reporter.js
// @ts-check

const fs = require('fs');
const { mkdir, rmdir, writeFile, copyFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { tmpdir } = require('os');
const SauceLabs = require('saucelabs').default;

const { exec } = require('./utils');

class MyReporter {
  constructor () {
    this.jobUrls = [];

    this.buildName = undefined;
    this.tags = [];
    this.projects = {};
    this.rootProject = undefined;

    this.workDir = this.createTmpFolder();
  }

  onBegin (config, suite) {
    this.buildName = config.projects[0]?.use?.sauce?.buildName;
    this.tags = config.projects[0]?.use?.sauce?.tags;
    this.region = config.projects[0]?.use?.sauce?.region || 'us-west-1';
    this.tld = this.region === 'staging' ? 'net' : 'com';

    this.api = new SauceLabs({
      user: process.env.SAUCE_USERNAME,
      key: process.env.SAUCE_ACCESS_KEY,
      region: this.region,
      tld: this.tld,
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
    await this.removeTmpFolder();
    this.displayReportedJobs(this.jobUrls);
  }

  displayReportedJobs (jobs) {
    console.log(`\nReported jobs to Sauce Labs:`);
    for (const job of jobs) {
      console.log(`  - ${job.url}`);
    }
    console.log();
  }

  async contructLogFile (project, file, token) {
    let consoleLog = `Project: ${project.title}\nFile: ${file.title}\n\n`;

    consoleLog = consoleLog.concat(
      this.formatTestCasesResults(file.tests, '')
    );

    for (const suite of file.suites) {
      consoleLog = consoleLog.concat(
        this.formatSuiteResult(suite)
      );
    }
    const consoleLogFilename = path.join(this.workDir, token, 'console.log')
    await writeFile(consoleLogFilename, consoleLog);
    return consoleLogFilename;
  }

  async reportFile(project, file) {
    const token = this.randomString();
    await mkdir(path.join(this.workDir, token));

    // Select project configuration and default to first available project.
    const projectConfig = this.projects[project.title] || this.projects[Object.keys(this.projects)[0]];

    const consoleLogFilename = await this.contructLogFile(project, file, token);

    // Screenshot / Video management
    const assets = this.getVideosAndScreenshots(file);
    assets.videos = await this.processVideos(assets.videos, token);

    // Global info
    const startedAt = this.findFirstStartedAt(file);
    const endedAt = this.findLastEndedAt(file);
    const passed = this.hasPassed(file);
    
    const suiteName = project.title ? `${project.title} - ${file.title}` : `${file.title}`;
    const jobBody = this.createBody({
      browserName: projectConfig?.use?.browserName || 'unknown',
      browserVersion: '1.0',
      build: this.buildName,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      success: passed,
      suiteName: suiteName,
      tags: this.tags || [],
    });
    const sessionID = await this.createJob(jobBody);
    await this.uploadAssets(sessionID, consoleLogFilename, assets.videos, assets.screenshots);

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

  async processVideos(webmVideos, token) {
    if (webmVideos.length == 0) {
      return;
    }

    const mp4Videos = [];

    for (const webmVideo of webmVideos) {
      const filename = path.basename(webmVideo);
      const mp4Filename = filename.replace(/\.webm$/, '.mp4');
      const mp4VideoPath = path.join(this.workDir, token, mp4Filename);

      try {
        await exec(`ffmpeg -i ${webmVideo} ${mp4VideoPath}`, {suppressLogs: true});
      } catch (e) {
        console.error(`Failed to convert ${webmVideo} to mp4: '${e}'`);
        return 
      }
      mp4Videos.push(mp4VideoPath)
    }

    const displayVideo = path.join(this.workDir, token, 'video.mp4');
    await copyFile(mp4Videos[0], displayVideo);
    return [displayVideo, ...mp4Videos];
  }

  async uploadAssets (sessionId, consoleLog, videosPath = [], screenshots = []) {
    const assets = [];

    assets.push(consoleLog);
    assets.push(...videosPath);
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
  }) {

    return {
      name: suiteName,
      user: process.env.SAUCE_USERNAME,
      startTime: startedAt,
      endTime: endedAt,
      framework: 'playwright',
      frameworkVersion: '15.0',
      status: 'complete',
      suite: suiteName,
      errors: [], // To Add
      passed: success,
      tags: tags,
      build: build,
      browserName,
      browserVersion,
      platformName: this.getOsName(),
      saucectlVersion: 'v0.0.0',
    };
  }

  createTmpFolder () {
    const workdir = path.join(tmpdir(), `sauce-playwright-reporter-${this.randomString()}`);
    fs.mkdirSync(workdir);
    return workdir;
  }

  randomString () {
    return crypto.randomBytes(6).readUIntLE(0,6).toString(36);
  }

  async removeTmpFolder (workdir) {
    if (!workdir) {
      return;
    }

    try {
      await rmdir(workdir, { recursive: true });
    } catch (e) {
      console.warn(`@saucelabs/playwright-reporter: Failed to remove tmp directory ${workdir}: ${e.message}`);
    }
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
