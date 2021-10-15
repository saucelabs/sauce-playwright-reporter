# sauce-playwright-plugin

This Playwright plugins reports each spec to your Sauce Labs account.

## Installation

Install from npm:
```
npm install @saucelabs/playwright-reporter
```

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


### Sauce Labs credentials

`SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables needs to be set to
allow the plugin to report your results to Sauce Labs.
Your Sauce Labs Username and Access Key are available from your
[dashboard](https://app.saucelabs.com/user-settings).

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
| build | Sets a build ID | String |
| tags | Sets tags | Array of String |
| region | Sets the region (Default: `us-west-1`) | String |

## Limitations

Some limitations applies to `@saucelabs/playwright-reporter`:
* Playwright version is not reported to Sauce Labs
* Browser version is not reported to Sauce Labs
* If two suites shares the same name, reports may be inacurate
