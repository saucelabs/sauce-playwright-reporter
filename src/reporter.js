// reporter.js
// @ts-check

const fs = require('fs');
const { mkdir, rmdir, writeFile, copyFile } = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { tmpdir } = require('os');
const SauceLabs = require('saucelabs').default;

const { Reporter } = require('@playwright/test/reporter');

const { exec } = require('./utils');

class MyReporter {
  constructor () {
    this.files = {};
    this.durations = {};
    this.config = {};

    this.region = 'us-west-1';
    this.tld = this.region === 'staging' ? 'net' : 'com';

    this.api = new SauceLabs({
      user: process.env.SAUCE_USERNAME,
      key: process.env.SAUCE_ACCESS_KEY,
      region: this.region,
      tld: this.tld,
    });

    this.workDir = this.createTmpFolder();
  }

  onBegin (config, suite) {
    console.log(`Starting the run with ${suite.allTests().length} tests`);
    this.config.buildName = config.projects[0]?.use?.sauce?.buildName;
    this.config.tags = config.projects[0]?.use?.sauce?.tags;
  }

  onTestBegin (test) {
    const categoryName = test.parent?.title;
    if (!this.durations[categoryName]) {
      this.durations[categoryName] = { startedAt: new Date() };
    }
  }

  onTestEnd (test, result) {
    const categoryName = test.parent?.title;
    this.durations[categoryName].endedAt = new Date();
    this.registerTestResult(test, result);
  }

  async onEnd (result) {
    await this.publishResults(result);
  }

  /* Custom made funcs */
  registerTestResult (test, result) {
    const fileName = test.parent?.title;

    const specResults = this.files[fileName] || { fileName, tests: [] };
    
    specResults.tests.push({
      title: test.title,
      status: result.status,
      duration: result.duration,
      screenshots: result.attachments.filter(file => file.name !== 'video').map(file => file.path),
      video: (result.attachments.filter(file => file.name === 'video').map(file => file.path))[0],
    });
    this.files[fileName] = specResults;
  }

  /* Export Results */
  async publishResults ({ status }) {
    for (const file of Object.keys(this.files)) {
      const { startedAt, endedAt } = this.durations[file];

      const token = this.randomString();
      await mkdir(path.join(this.workDir, token));
      const consoleFilename = await this.constructConsoleLog(this.files[file], token);

      const body = this.createBody({
        suiteName: `${this.config.buildName} - ${file}`,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        success: status === 'passed',
        tags: this.config.tags || [],
        build: this.config.buildName,
        browserName: 'chrome', // Not available
        browserVersion: '1.0.0', // Not available
      });
  
      this.sessionId = await this.createJob(body);
      if (this.sessionId) {
        console.log("SessionID:", this.sessionId);

        const webmVideos = this.files[file].tests.map(t => t.video);
        const videosPath = await this.processVideos(webmVideos, token);
        const screenshots = this.gatherScreenshots(this.files[file].tests);
        await this.uploadAssets(this.sessionId, consoleFilename, videosPath, screenshots);
      }
    }
    await this.removeTmpFolder(this.workDir);
  }

  gatherScreenshots (tests) {
    const screenshots = [];
    for (const t of tests) {
      for (const ss of t.screenshots) {
        screenshots.push(ss);
      }
    }
    return screenshots;
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

  async constructConsoleLog (file, token) {
    let consoleLog = `${file.fileName}\n`;

    for (const test of file.tests) {
      const status = test.status === 'passed' ? '✓' : '✗';
      consoleLog = consoleLog.concat(`  ${status} ${test.title} (${test.duration}ms)\n`);
    }

    consoleLog = consoleLog.concat(`\n`);

    const consoleFilename = path.join(this.workDir, token, 'console.log');
    await writeFile(consoleFilename, consoleLog);
    return consoleFilename;
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
      platformName: 'mac',
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
}

module.exports = MyReporter;
