import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const browserCandidates = [
  process.env.TEST_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browserPath = browserCandidates.find(file => existsSync(file));
const files = process.argv.slice(2);
const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=2',
  ...((files.length ? files : readdirSync('tests').filter(file => file.endsWith('.test.mjs')).map(file => path.join('tests', file)))),
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ESBUILD_MODULE_PATH: process.env.ESBUILD_MODULE_PATH || require.resolve('esbuild'),
    PGLITE_MODULE_PATH: process.env.PGLITE_MODULE_PATH || require.resolve('@electric-sql/pglite'),
    ...(browserPath ? { TEST_BROWSER_PATH: browserPath } : {}),
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
