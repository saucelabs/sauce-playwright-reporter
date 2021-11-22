# sauce-playwright-plugin

This Playwright plugins reports each project to your Sauce Labs account.

## Installation

Install from npm:
```
npm install @saucelabs/playwright-reporter
```

### Sauce Labs credentials

`SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables needs to be set to
allow the plugin to report your results to Sauce Labs.
Your Sauce Labs Username and Access Key are available from your
[dashboard](https://app.saucelabs.com/user-settings).


## Usage

Add to default reporter:
```
npx playwright test  --reporter=line,@saucelabs/playwright-reporter
```

Use only `@saucelabs/playwright-reporter`:
```
npx playwright test  --reporter=@saucelabs/playwright-reporter
```

You can also configure using `playwright.config.js`. To achieve that, add `'@saucelabs/playwright-reporter'` to the reporter section of your configuration:
```
const config = {
  reporter: [
    ['@saucelabs/playwright-reporter'],
  ],
  // Rest of your config goes here
};
```

### Plugin configuration

`@saucelabs/playwright-plugin` is configurable through your `playwright.config.js` or `playwright.config.ts` file.

Example:
```
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

| Name | Description | Kind |
| --- | --- | --- |
| build | Sets a build ID. (Default: `''`) | String |
| tags | Tags to add to the uploaded Sauce job. (Default: `[]`) | String[] |
| region | Sets the region. (Default: `us-west-1`) | `us-west-1` \| `eu-central-1` |
| upload | Whether to upload report and assets to Sauce (Default: `true`) | boolean |
| outputFile | The local path to write the sauce test report. | String |

You can also use the `SAUCE_REPORT_OUTPUT_NAME` environment variable as an alternative to the `outputFile` reporter option in your playwright config.

## Limitations

Some limitations applies to `@saucelabs/playwright-reporter`:
* Before playwright@v1.16.3, Playwright version is not reported to Sauce Labs.
* Browser version is not reported to Sauce Labs.
