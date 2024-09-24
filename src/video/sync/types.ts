import { Test } from '@saucelabs/sauce-json-reporter';

export type Milliseconds = number;

/**
 * VideoFile represents a video on disk.
 */
export type VideoFile = {
  /**
   * The path to the video on disk.
   */
  path?: string;
  /**
   * The duration of the video file in milliseconds.
   */
  duration?: Milliseconds;
};

export interface Syncer {
  sync(test: Test, video: VideoFile): void;
}
