import * as fs from 'fs';
import * as readline from 'readline';
import { TestCase } from "@playwright/test/reporter";

/**
 * From a given TestCase, return the lines of code for the TestSteps
 * executed during the test run.
 *
 * NOTE: This does not return the entire body of a TestCase, only the TestSteps
 */
export function getLines(testCase: TestCase) {
  const result = testCase.results[testCase.results.length - 1];
  const stepLines = result.steps
    .map((step) => step.location?.line)
    .filter((line): line is number => line !== undefined);

  const file = fs.readFileSync(testCase.location.file, { encoding: 'utf8' });
  const fileLines = file.split(/\r?\n/);

  const lines : Set<string> = new Set();

  for (const stepLine of stepLines) {
    if (stepLine <= fileLines.length) {
      const fileLine = fileLines[stepLine - 1];
      lines.add(fileLine.trim());
    }
  }

  // NOTE: Converting Set to Array here preserves insertion order
  return Array.from(lines);
}
