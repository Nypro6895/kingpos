// Screenshots of production React components, with fictional demonstration data.
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

const fixture = {
  canManage: true, addOnLinks: [],
  staff: [{ id: 'staff-1', displayName: 'Lan Anh', avatarPath: null, avatarUrl: null, bookingReady: true, isActive: true, onlineBookingEnabled: true }],
  services: [['service-1', 'Sơn gel', 'Móng tay', 35, 45], ['service-2', 'Chăm sóc móng tay', 'Móng tay', 25, 30], ['service-3', 'Pedicure Spa', 'Móng chân', 50, 60]].map(([id, name, category, base_price, duration_minutes]) => ({ id, name, category, base_price, duration_minutes, salon_id: 'demo', description: 'Dịch vụ minh họa của tiệm.', is_active: true, online_booking_enabled: true, created_at: '2026-10-08', updated_at: '2026-10-08', addOnServiceIds: [], bookingStaffIds: ['staff-1'], readiness: { ready: true, needsSetup: false, bookingStaffCount: 1, eligibleBookingStaffCount: 1, reasons: [] } })),
};
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{WorkspaceLanguageProvider}from'./components/workspace-language';
import{WorkspaceToolbar}from'./components/workspace-toolbar';
import{ServicesManager}from'./app/services/services-manager';
import{CustomerForm}from'./app/customers/customer-form';
import './app/services/services.css';
const customer=location.search.includes('customers');
createRoot(document.getElementById('root')).render(<WorkspaceLanguageProvider enabled portableEnabled={false} expiresAt={null}><WorkspaceToolbar title={customer?'Customers':'Services'}><span>Reylumi</span></WorkspaceToolbar>{customer?<CustomerForm mode="edit" action={async()=>{}} customer={{id:'demo',name:'Khách minh họa',phone:'3125550100',email:'demo@example.com',notes:'Khách thích màu hồng nhạt.',staff_notes:'Xác nhận mẫu trước khi làm.',internal_notes:'Dữ liệu minh họa, không phải thông tin khách thật.',status:'active'}}/>:<ServicesManager data={${JSON.stringify(fixture)}} initialServiceId={location.search.includes('edit')?'service-1':null}/>}</WorkspaceLanguageProvider>);
` }, outfile: 'preview.js', bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'preview-boundaries', setup(b) {
  b.onResolve({ filter: /^(next\/navigation|next\/link|.*services\/actions|.*contextual-support|.*delete-unused-button)$/ }, a => ({ path: a.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ resolveDir: process.cwd(), loader: 'js', contents: a.path.includes('navigation') ? 'export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>"/services";export const useRouter=()=>({refresh(){},replace(){}});' : a.path.includes('next/link') ? `import React from 'react';export default function Link(p){return React.createElement('a',p)}` : a.path.includes('services/actions') ? 'export async function createServiceAction(){}export async function saveServiceConfigsAction(){}' : a.path.includes('contextual-support') ? 'export function ContextualSupport(){return null}' : 'export function DeleteUnusedButton(){return null}' }));
} }] });
const globals = await postcss([tailwind()]).process(fs.readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' });
const css = globals.css + bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html lang="vi"><head><style>${css}body{margin:0;font-family:Arial,sans-serif;background:#fff}#root{max-width:1120px;padding:28px;margin:auto}</style></head><body><div id="root"></div><script>${js}</script></body></html>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
fs.mkdirSync('public/market/features/vietnamese-language', { recursive: true });
try {
  for (const [file, query] of [['services', ''], ['service-settings', '?edit'], ['customers', '?customers']]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 950 }, deviceScaleFactor: 1 });
    const errors = [];page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
    await page.getByRole('heading', { name: file === 'customers' ? 'Khách hàng' : 'Dịch vụ', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(errors.join('\n'));
    const root = await page.locator('#root').boundingBox();
    const content = customerHeight();
    function customerHeight(){ return file === 'services' ? 475 : root.height; }
    await page.screenshot({ clip: {x:root.x,y:root.y,width:root.width,height:content}, path: `public/market/features/vietnamese-language/${file}-v1.png` });
    console.log(file, await page.locator('#root').boundingBox());
    await page.close();
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
