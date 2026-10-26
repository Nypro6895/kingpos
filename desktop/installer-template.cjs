'use strict';
const { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } = require('node:fs');
const { join, dirname } = require('node:path');

function prepareInstallerTemplate(buildDirectory) {
  const template = join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/include/installUtil.nsh');
  const source = readFileSync(template, 'utf8');
  const original = '!insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"';
  if (source.split(original).length !== 2) throw Error('NSIS upgrade template changed; review the legacy upgrade fix before building.');
  // Use this build's repaired uninstaller against the previous installation.
  // The installed 0.7.1 uninstaller would reintroduce its unbounded CIM query.
  const repaired = source.replace(original, 'File "/oname=$PLUGINSDIR\\old-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"');
  const directory = join(buildDirectory, 'installer');
  mkdirSync(directory, { recursive: true });
  // Preserve current-directory resolution (notably builder's multiUser.nsh,
  // whose name collides with NSIS's built-in MultiUser.nsh on Windows).
  const templates = dirname(dirname(template));
  for (const entry of readdirSync(templates, { withFileTypes: true })) {
    if (entry.isFile()) copyFileSync(join(templates, entry.name), join(directory, entry.name));
  }
  writeFileSync(join(directory, 'installUtil.nsh'), repaired);
}

module.exports = { prepareInstallerTemplate };
