import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VideoFile {
  path: string;
  duration: number;
}

export class Timeline {
  duration: number;
  videoFiles: VideoFile[];

  constructor() {
    this.duration = 0;
    this.videoFiles = [];
  }

  public reset() {
    this.duration = 0;
    this.videoFiles = [];
  }

  public addVideo(video: VideoFile) {
    this.videoFiles.push({ ...video });
    this.duration += video.duration;
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

    this.reset();

    return outputFile;
  }
}
