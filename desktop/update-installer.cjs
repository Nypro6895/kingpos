'use strict';
const { createReadStream } = require('node:fs');
const { copyFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { dirname, join, basename } = require('node:path');

async function checksum(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}

// electron-updater 6.8.9 uses the URL basename, ignoring Content-Disposition.
// Repair a cache from the old /download/windows feed and recheck the bytes
// immediately before installation. No user profile or ticket data is touched.
async function prepareUpdateInstaller(engine) {
  const helper = engine.downloadedUpdateHelper;
  const file = engine.installerPath;
  const expected = helper?.downloadedFileInfo?.sha512;
  if (!file || !expected || await checksum(file) !== expected) {
    throw Error('The update file could not be verified. Download the update again.');
  }
  if (file.toLowerCase().endsWith('.exe')) return file;
  const executable = join(dirname(file), 'KingPOS-Portable-Update.exe');
  await copyFile(file, executable);
  if (await checksum(executable) !== expected) throw Error('The update file could not be verified. Download the update again.');
  await helper.setDownloadedFile(executable, helper.packageFile, helper.versionInfo,
    helper.fileInfo, basename(executable), true);
  return executable;
}

// In 6.8.9 quitAndInstall quits before its asynchronous Windows spawn settles.
// Preserve the engine's NSIS arguments/elevation policy but quit only after a
// confirmed launch. A failed launch keeps the current POS usable for retry.
async function launchUpdateInstaller(engine) {
  const original = engine.spawnLog;
  const attempts = [];
  let launched = false;
  let failure;
  engine.spawnLog = function (...args) {
    const task = Promise.resolve().then(() => original.apply(this, args)).then(value => {
      launched = true;
      return value;
    });
    attempts.push(task.catch(error => { failure = error; }));
    return task;
  };
  try {
    if (!engine.install(true, true)) throw Error('The installer could not start. Please try again.');
    let completed = 0;
    while (completed < attempts.length) {
      const batch = attempts.slice(completed);
      completed = attempts.length;
      await Promise.all(batch);
      // Allow the EACCES handler to enqueue its ordinary elevation attempt.
      await Promise.resolve();
    }
    if (!launched) throw failure || Error('The installer could not start. Please try again.');
  } catch (error) {
    engine.quitAndInstallCalled = false;
    throw error;
  } finally {
    engine.spawnLog = original;
  }
}

module.exports = { prepareUpdateInstaller, launchUpdateInstaller };
