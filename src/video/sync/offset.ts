import { Test } from '@saucelabs/sauce-json-reporter';
import { Syncer, VideoFile } from './types';

/**
 * OffsetSyncer is used to synchronize the video start time of a test case
 * against a simple offset.
 */
export class OffsetSyncer implements Syncer {
  private videoOffset: number;

  constructor(offset: number) {
    this.videoOffset = offset;
  }

  public sync(test: Test, _video: VideoFile): void {
    test.videoTimestamp = (test.startTime.getTime() - this.videoOffset) / 1000;
  }
}
