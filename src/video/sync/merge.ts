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

type Result<T, E> =
  | { kind: 'ok'; value: T }
  | { kind: 'noop'; value: null }
  | { kind: 'err'; value: E };

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

  public async mergeVideos(): Promise<Result<string, Error>> {
    if (this.videoFiles.length === 0) {
      return { kind: 'noop', value: null };
    }

    const hasFFMpeg =
      child_process.spawnSync('ffmpeg', ['-version']).status === 0;
    if (!hasFFMpeg) {
      const e = new Error(
        'ffmpeg could not be found. Ensure ffmpeg is available in your PATH',
      );
      return { kind: 'err', value: e };
    }

    let tmpDir: string;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'pw-sauce-video-'));
      process.on('exit', () => {
        // NOTE: exit handler must be synchronous
        rmSync(tmpDir, { recursive: true, force: true });
      });
    } catch (e) {
      const error = e as Error;
      return { kind: 'err', value: error };
    }

    const inputFile = join(tmpDir, 'videos.txt');
    const outputFile = join(tmpDir, 'video.mp4');

    try {
      await writeFile(
        inputFile,
        this.videoFiles.map((v) => `file '${v.path}'`).join('\n'),
      );
    } catch (e) {
      return { kind: 'err', value: e as Error };
    }

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
    const cmd = ['ffmpeg', ...args].join(' ');
    try {
      await exec(cmd);
    } catch (e) {
      const error = e as Error;
      let msg = `ffmpeg command: ${cmd}`;
      if ('stdout' in error) {
        msg = `${msg}\nstdout: ${error.stdout}`;
      }
      if ('stderr' in error) {
        msg = `${msg}\nstderr: ${error.stderr}`;
      }
      return { kind: 'err', value: new Error(msg) };
    }

    return { kind: 'ok', value: outputFile };
  }
}
