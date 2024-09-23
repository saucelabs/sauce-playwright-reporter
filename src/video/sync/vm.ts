import { Test } from "@saucelabs/sauce-json-reporter";
import { Syncer, VideoFile } from "./types";

export class VMSyncer implements Syncer {
  private videoOffset: number;

  constructor(offset: number) {
    this.videoOffset = offset;
  }

  public sync(test: Test, _video: VideoFile): void {
    test.videoTimestamp = test.startTime.getTime() - this.videoOffset;
  }
}
