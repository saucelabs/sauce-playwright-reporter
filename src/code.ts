import * as fs from 'fs';
import * as readline from 'readline';
import { TestCase } from "@playwright/test/reporter";

/**
 * From a given TestCase, return the lines of code for the TestSteps
 * executed during the test run.
 *
 * NOTE: This does not return the entire body of a TestCase, only the TestSteps
 */
export async function getLines(testCase: TestCase) {
  const result = testCase.results[testCase.results.length - 1];
  const stepLines = new Set(
    result.steps
      .map((step) => step.location?.line)
      .filter((line): line is number => line !== undefined));

  const fileStream = fs.createReadStream(testCase.location.file);

  const rl = readline.createInterface({
    input: fileStream,
    // NOTE: we use the crlfDelay option to recognize all instances of CR LF ('\r\n') as a single line break.
    crlfDelay: Infinity,
  });

  const lines : string[] = [];
  let currLine = 1;

  for await (const l of rl) {
    if (stepLines.has(currLine)) {
      lines.push(l.trim());
    }
    currLine++;
  }

  return lines;
}
