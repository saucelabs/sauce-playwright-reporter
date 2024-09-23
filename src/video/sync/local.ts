import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Syncer, VideoFile } from './types';
import { Test } from '@saucelabs/sauce-json-reporter';

export class LocalSyncer implements Syncer {
  duration: number;
  videoFiles: VideoFile[];

  constructor() {
    this.duration = 0;
    this.videoFiles = [];
  }

  public sync(test: Test, video: VideoFile): void {
    test.videoTimestamp = this.duration / 1000;
    this.addVideo(video);
  }

  public addVideo(video: VideoFile) {
    if (video.path && video.duration) {
      this.videoFiles.push({ ...video });
      this.duration += video.duration;
    }
  }

  public generateVideo() {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pw-sauce-video-'));
    const inputFile = join(tmpDir, 'videos.txt');
    const outputFile = join(tmpDir, 'video.mp4');

    writeFileSync(
      inputFile,
      this.videoFiles.map((v) => `file '${v.path}'`).join('\n'),
    );

    const args = [
      "-f",
      "concat",
      "-safe",
      "0",
      "-threads",
      "1",
      "-y",
      "-benchmark",
      "-i",
      inputFile,
      outputFile,
    ];
    spawnSync("ffmpeg", args);

    return outputFile;
  }
}
