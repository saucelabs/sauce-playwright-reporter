import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Syncer, VideoFile } from './types';
import { Test } from '@saucelabs/sauce-json-reporter';

/**
 * MergeSyncer is used to synchronize the video start time of a test case with
 * a collection of video files. Videos are aggregated and their cumulative
 * runtime is used to mark the video start time of the next test case to be
 * added.
 */
export class MergeSyncer implements Syncer {
  duration: number;
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

  public mergeVideos() {
    if (this.videoFiles.length === 0) {
      return;
    }
    const hasFFMpeg = spawnSync('ffmpeg', ['-version']).status === 0;
    if (!hasFFMpeg) {
      console.error(
        `Failed to merge videos: ffmpeg could not be found. \
Ensure ffmpeg is available in your PATH.`,
      );
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'pw-sauce-video-'));
    const inputFile = join(tmpDir, 'videos.txt');
    const outputFile = join(tmpDir, 'video.mp4');

    writeFileSync(
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
    const result = spawnSync('ffmpeg', args);
    if (result.status !== 0) {
      console.error('\nFailed to merge videos.');
      console.error('Command:', `ffmpeg ${args.join(' ')}`);
      console.error(`stdout: ${result.stdout.toString('utf8')}`);
      console.error(`stderr: ${result.stderr.toString('utf8')}`);

      return;
    }

    return outputFile;
  }
}
