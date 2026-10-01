'use strict';
// Publish only complete, checksum-verified builds; manifest is switched last.
const { readFileSync, copyFileSync, writeFileSync, renameSync, mkdirSync } = require('node:fs');
const { resolve, join, basename } = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');
const source = resolve(process.argv[2] || join(__dirname, 'dist'));
const target = resolve(__dirname, '../public/desktop-updates');
const text = readFileSync(join(source, 'latest.yml'), 'utf8');
const manifest = yaml.load(text);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !manifest.files?.length) throw Error('Invalid local release');
mkdirSync(target, { recursive: true });
for (const file of manifest.files) {
  const name = decodeURIComponent(file.url);
  if (basename(name) !== name || !/^KingPOS Portable Test-Setup-[\d.]+\.exe$/.test(name)) throw Error('Unexpected update file');
  const input = join(source, name), data = readFileSync(input);
  if (createHash('sha512').update(data).digest('base64') !== file.sha512 || data.length !== file.size) throw Error('Installer checksum mismatch');
  copyFileSync(input, join(target, name + '.tmp'));
  renameSync(join(target, name + '.tmp'), join(target, name));
}
writeFileSync(join(target, 'latest.yml.tmp'), text);
renameSync(join(target, 'latest.yml.tmp'), join(target, 'latest.yml'));
console.log(`Published local KingPOS ${manifest.version} to ${target}`);
