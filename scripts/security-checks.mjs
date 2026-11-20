import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const existingRegressions = [
  'abuse-signals.test.mjs', 'session-policy-runtime.test.mjs', 'auth-read-availability.test.mjs',
  'auth-session-parallel-validation.test.mjs', 'login-security-contract.test.mjs',
  'abuse-prevention.integration.test.mjs', 'staff-tickets-security.test.mjs',
  'market-safari-checkout.test.mjs', 'owner-pos-draft-submit-race.test.mjs',
  'recovery-completion-runtime.test.mjs', 'app-local-advertising-transport.test.mjs',
  'app-local-shell-auxiliary.test.mjs',
];
const selected = new Set([...readdirSync('tests').filter(file => /^security-.*\.test\.mjs$/.test(file)), ...existingRegressions]);
const files = [...selected].sort().map(file => `tests/${file}`);
if (!files.every(existsSync)) throw Error('Required security regression file is missing');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], {
  stdio: 'inherit', windowsHide: true, env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
