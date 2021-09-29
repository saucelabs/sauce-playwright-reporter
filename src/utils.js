const shell = require('shelljs');

const COMMAND_TIMEOUT = 5000;

function exec (expression, {suppressLogs = false}) {
  const cp = shell.exec(expression, { async: true, silent: true });
  if (!suppressLogs) {
    cp.stdout.on('data', (data) => console.log(`${data}`));
    cp.stderr.on('data', (data) => console.log(`${data}`));
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, COMMAND_TIMEOUT);
    cp.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

module.exports = { exec };
