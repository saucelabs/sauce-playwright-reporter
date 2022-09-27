import * as fs from 'fs';
import * as readline from 'readline';
import { TestCase } from "@playwright/test/reporter";

function isDefined<T>(argument: T | undefined): argument is T {
    return argument !== undefined
}

export async function getLines(testCase: TestCase) {
  const result = testCase.results[testCase.results.length - 1];
  const stepLines = new Set(
    result.steps
      .map((step) => step.location?.line)
      .filter(isDefined));

  const fileStream = fs.createReadStream(testCase.location.file);

  const rl = readline.createInterface({
    input: fileStream,
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
