# sauce-playwright-plugin

This Playwright plugin reports each project to your Sauce Labs account.

## Installation

Install from npm:
```sh
npm install @saucelabs/playwright-reporter
```

### Sauce Labs Credentials

Set the `SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables to allow the plugin to report your results to Sauce Labs. Your Sauce Labs Username and Access Key are available from your [dashboard](https://app.saucelabs.com/user-settings).

## Usage

Add to the default reporter:
```sh
npx playwright test --reporter=line,@saucelabs/playwright-reporter
```

Use only `@saucelabs/playwright-reporter`:
```sh
npx playwright test --reporter=@saucelabs/playwright-reporter
```

You can also configure it using `playwright.config.js`. To do that, add `'@saucelabs/playwright-reporter'` to the reporter section of your configuration:
```js
const config = {
  reporter: [
    ['@saucelabs/playwright-reporter'],
  ],
  // Rest of your config goes here
};
```

### Plugin Configuration

`@saucelabs/playwright-reporter` is configurable through your `playwright.config.js` or `playwright.config.ts` file.

Example:
```js
const config = {
  reporter: [
    ['@saucelabs/playwright-reporter', {
      buildName: 'My Playwright Build',
      region: 'us-west-1',
      tags: [
        'playwright',
        'demo',
      ],
    }],
  ],
  // Rest of your config goes here
};
```

| Name         | Description                                                                                      | Type                           |
|--------------|--------------------------------------------------------------------------------------------------|--------------------------------|
| `buildName`  | Sets a build ID. <br> Default: `''`                                                              | `string`                       |
| `tags`       | Tags to add to the uploaded Sauce job. <br> Default: `[]`                                        | `string[]`                     |
| `region`     | Sets the region. <br> Default: `us-west-1`                                                       | `us-west-1` \| `eu-central-1`  |
| `upload`     | Whether to upload report and assets to Sauce Labs. <br> Default: `true`                          | `boolean`                      |
| `outputFile` | The local path to write the Sauce test report. Can be set in env var `SAUCE_REPORT_OUTPUT_NAME`. | `string`                       |

## Limitations

Some limitations apply to `@saucelabs/playwright-reporter`:
* For Playwright versions before v1.16.3, the Playwright version is not reported to Sauce Labs.
* The browser version is not reported to Sauce Labs.

## Development

### Running Locally

To test the reporter locally, link it to itself and then run a test with the reporter set.

```sh
$ npm link
$ npm link @saucelabs/playwright-reporter
$ npx playwright test --reporter=@saucelabs/playwright-reporter
```

### Debug

After linking with `npm link`, you can run your Playwright tests with the environment variable `DEBUG="@saucelabs/playwright-reporter:*"` to see additional debug output.

```sh
$ DEBUG="@saucelabs/playwright-reporter:*" npx playwright test --reporter=@saucelabs/playwright-reporter
```
