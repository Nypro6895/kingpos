import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Select from `xcrun simctl list devices available --json` on the CI host. */
export function selectSimulator(inventory, family = 'iphone') {
  const prefix = family === 'iphone' ? 'iPhone' : family === 'ipad' ? 'iPad' : null;
  if (!prefix) throw Error('Simulator family must be iphone or ipad');
  if (!inventory?.devices || typeof inventory.devices !== 'object') throw Error('Simulator device inventory is invalid');
  for (const [runtime, devices] of Object.entries(inventory.devices)) {
    if (!runtime.includes('.iOS-') || !Array.isArray(devices)) continue;
    const selected = devices.find(device => device?.isAvailable === true &&
      typeof device.name === 'string' && device.name.startsWith(prefix) &&
      typeof device.udid === 'string' && /^[A-F0-9-]{36}$/i.test(device.udid));
    if (selected) return selected.udid;
  }
  throw Error('No available ' + prefix + ' Simulator is installed in this Xcode environment.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, family = 'iphone', ...extra] = process.argv.slice(2);
    if (!file || extra.length) throw Error('Usage: select-simulator.mjs DEVICE-JSON [iphone|ipad]');
    process.stdout.write(selectSimulator(JSON.parse(readFileSync(file, 'utf8')), family) + '\n');
  } catch (error) { console.error(error.message);process.exitCode = 1; }
}
