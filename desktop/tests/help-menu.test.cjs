'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function menu(openExternal) {
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = source.indexOf('function setupMenu() {');
  const end = source.indexOf('\n}', start) + 2;
  let template;
  const messages = [];
  const context = {
    Menu: { buildFromTemplate(value) { template = value; return value; }, setApplicationMenu() {} },
    shell: { openExternal }, dialog: { showMessageBox: async (...args) => messages.push(args) },
    win: {},
  };
  vm.runInNewContext(source.slice(start, end) + '\nsetupMenu();', context);
  return { help: template[0].submenu.find(item => item.label === 'Help / Hướng dẫn sử dụng'), messages };
}

test('three-dot app menu opens the shared online guide without navigating POS', async () => {
  const opened = [];
  const { help, messages } = menu(async url => opened.push(url));
  assert(help);
  await help.click();
  assert.deepEqual(opened, ['https://reylumi.com/help/windows-portable']);
  assert.equal(messages.length, 0);
});

test('browser launch failure gives a bilingual message and the guide address', async () => {
  const { help, messages } = menu(async () => { throw Error('No browser'); });
  await help.click();
  assert.equal(messages.length, 1);
  assert.match(messages[0][1].message, /Không mở được/);
  assert.match(messages[0][1].detail, /https:\/\/reylumi.com\/help\/windows-portable/);
});
