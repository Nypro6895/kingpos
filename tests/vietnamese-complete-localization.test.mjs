import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync, build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { workspaceFiles, copyOccurrences } from '../scripts/workspace-copy-catalog.mjs';

const mod = { exports: {} };
new Function('module', 'exports', 'require', transformSync(fs.readFileSync('lib/vietnamese-dictionary.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code)(mod, mod.exports, specifier => JSON.parse(fs.readFileSync(specifier.replace('@/', ''), 'utf8')));
const { VIETNAMESE_UI, translateVietnamese: t } = mod.exports;

test('Workspace copy has dictionary coverage and templates preserve customer data', () => {
  const missing = workspaceFiles().flatMap(copyOccurrences).filter(row => !VIETNAMESE_UI[row.text]);
  assert.deepEqual(missing, []);
  assert.equal(t('Book exact look', true), 'Đặt lịch theo đúng mẫu');
  assert.equal(t('No-show type', true), 'Loại không đến');
  assert.equal(t('Device: Today Salon.', true), 'Thiết bị: Today Salon.');
  assert.equal(t('17 unread notifications', true), '17 thông báo chưa đọc');
  assert.equal(t('12 min ago', true), '12 phút trước');
  assert.equal(t('Save changes', false), 'Save changes');
  assert.equal(t('Emily Smith / service A / $39.99', true), 'Emily Smith / service A / $39.99');
});

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('Real customer form localizes labels, validation, placeholders, pending state and retains submitted values', { skip: !fs.existsSync(executablePath) }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{WorkspaceLanguageProvider,WorkspaceText,WorkspaceElement}from'./components/workspace-language';
    import{CustomerForm}from'./app/customers/customer-form';
    import{WorkspaceToolbar}from'./components/workspace-toolbar';
    const customer={id:'id',name:'Today',phone:'3125550199',email:'customer@example.com',notes:'Keep original note',staff_notes:'Staff note',internal_notes:'Owner note',status:'active'};
    async function action(data){window.submitted=Object.fromEntries(data);await new Promise(r=>window.finish=r)};
    createRoot(document.getElementById('root')).render(<WorkspaceLanguageProvider enabled={true} portableEnabled={false} expiresAt={null}><WorkspaceLanguageProvider portableSession enabled={true} portableEnabled={true} expiresAt={null}><WorkspaceToolbar title="Customers"><WorkspaceText text="Save changes"/></WorkspaceToolbar><WorkspaceElement as="input" placeholder="Search services" aria-label="Search services"/><CustomerForm action={action} customer={customer} mode="edit" error="Unable to save daily closing."/></WorkspaceLanguageProvider></WorkspaceLanguageProvider>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'test-boundaries', setup(b) {
    b.onResolve({ filter: /^(next\/navigation|next\/link|.*\.module\.css)$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: a.path.includes('navigation') ? 'export const usePathname=()=>location.pathname;' : a.path.includes('link') ? `import React from 'react';export default function Link(p){return React.createElement('a',p)}` : 'export default {};', resolveDir: process.cwd(), loader: 'js' }));
  } }] });
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html><body><div id="root"></div><script>${result.outputFiles[0].text}</script></body></html>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const route of ['/customers', '/staff/today', '/pos/portable']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
      await page.getByRole('heading', { name: 'Khách hàng', exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder('Tìm dịch vụ').count(), 1);
      assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
      assert.equal(await page.locator('[name=name]').inputValue(), 'Today');
      assert.equal(await page.locator('[name=notes]').inputValue(), 'Keep original note');
      assert.equal(await page.locator('[name=status]').inputValue(), 'active');
      await page.getByRole('button', { name: 'Lưu khách hàng', exact: true }).click();
      await page.getByRole('button', { name: 'Đang lưu…', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.submitted.name), 'Today');
      assert.equal(await page.evaluate(() => window.submitted.status), 'active');
      await page.evaluate(() => window.finish());
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
