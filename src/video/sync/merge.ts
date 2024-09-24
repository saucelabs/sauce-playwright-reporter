import child_process from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { Test } from '@saucelabs/sauce-json-reporter';

import { Milliseconds, Syncer, VideoFile } from './types';

const exec = promisify(child_process.exec);

/**
 * MergeSyncer is used to synchronize the video start time of a test case with
 * a collection of video files. Videos are aggregated and their cumulative
 * runtime is used to mark the video start time of the next test case to be
 * added.
 */
export class MergeSyncer implements Syncer {
  duration: Milliseconds;
  videoFiles: VideoFile[];

  constructor() {
    this.duration = 0;
    this.videoFiles = [];
  }

  public sync(test: Test, video: VideoFile): void {
    if (video.path && video.duration) {
      test.videoTimestamp = this.duration / 1000;

      this.videoFiles.push({ ...video });
      this.duration += video.duration;
    }
  }

  public async mergeVideos() {
    if (this.videoFiles.length === 0) {
      return;
    }
    const hasFFMpeg = child_process.spawnSync('ffmpeg', ['-version']).status === 0;
    if (!hasFFMpeg) {
      console.error(
        `Failed to merge videos: ffmpeg could not be found. \
Ensure ffmpeg is available in your PATH`,
      );
      return;
    }

    let tmpDir: string;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'pw-sauce-video-'));
    } catch (e) {
      console.error(`Failed to merge videos: could not create temp dir`, e);
      return;
    }

    const inputFile = join(tmpDir, 'videos.txt');
    let outputFile: string | undefined = join(tmpDir, 'video.mp4');

    try {
      await writeFile(
        inputFile,
        this.videoFiles.map((v) => `file '${v.path}'`).join('\n'),
      );

      const args = [
        '-f',
        'concat',
        '-safe',
        '0',
        '-threads',
        '1',
        '-y',
        '-i',
        inputFile,
        outputFile,
      ];
      await exec(['ffmpeg', ...args].join(' '));
    } catch (e) {
      const error = e as Error;
      console.error('\nFailed to merge videos:', error.message);

      outputFile = undefined;
    } finally {
      process.on('exit', () => {
        // NOTE: exit handler must be synchronous
        rmSync(tmpDir, { recursive: true, force: true });
      });
    }

    return outputFile;
  }
}
