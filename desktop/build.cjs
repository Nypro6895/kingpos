'use strict';
const { build, Platform, Arch } = require('electron-builder');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { validConfig } = require('./policy.cjs');
const release = process.argv[2] === 'release';
if (!release && process.argv[2] !== 'test') throw Error('Choose test or release');
const origin = process.env.KINGPOS_DESKTOP_ORIGIN || 'http://localhost:3107';
const feed = process.env.KINGPOS_DESKTOP_UPDATE_URL || (!release ? origin + '/desktop-updates/' : undefined);
const config = validConfig({ origin, channel: release ? 'release' : 'test', updates: true,
  unsignedUpdates: !release, updateUrl: feed, publisher: release ? process.env.KINGPOS_DESKTOP_PUBLISHER : undefined });
if (release && (!config.publisher || !feed || new URL(feed).protocol !== 'https:' || !process.env.CSC_LINK)) throw Error('Release requires HTTPS origin/update feed, publisher and signing credentials (CSC_LINK).');
async function run() {
const png = await require('../node_modules/sharp')(join(__dirname, '../public/brand/reylumi-favicon.png')).resize(256,256).png().toBuffer();
// Windows accepts a PNG image inside ICO. Preserve the existing brand artwork.
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
mkdirSync(join(__dirname, 'build'), { recursive: true });
writeFileSync(join(__dirname, 'build/icon.ico'), Buffer.concat([header, png]));
const original = readFileSync(join(__dirname, 'config.json'));
writeFileSync(join(__dirname, 'config.json'), JSON.stringify(config));
await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: {
  electronDist: process.env.KINGPOS_ELECTRON_DIST || undefined,
  appId: release ? 'com.kingpos.portable' : 'com.kingpos.portable.test', productName: release ? 'KingPOS Portable' : 'KingPOS Portable Test',
  directories: { output: process.env.KINGPOS_DESKTOP_BUILD_DIR || 'dist', buildResources: 'build' },
  files: ['main.cjs','preload.cjs','display-preload.cjs','policy.cjs','vault.cjs','offline-shell.cjs','update-plan.cjs','config.json','unavailable.html','unavailable.js','package.json'],
  asar: true, artifactName: '${productName}-Setup-${version}.${ext}',
  forceCodeSigning: release,
  win: { target: 'nsis', icon: 'build/icon.ico', signtoolOptions: release ? { publisherName: config.publisher } : undefined, verifyUpdateCodeSignature: release, signExecutable: release },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, deleteAppDataOnUninstall: false, runAfterFinish: true },
  publish: [{ provider: 'generic', url: feed }],
}, publish: 'never' }).finally(() => writeFileSync(join(__dirname, 'config.json'), original));
}
run().catch(error => { console.error(error.message); process.exitCode=1; });
