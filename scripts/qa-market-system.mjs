import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const catalog=[['vietnamese-language','Vietnamese Language',199],['booking-policy','Booking Policy',99],['booking-deposit','Booking Deposit',199],['checkin-receipt','Checkin Receipt',99]].map(([plugin_id,name,price_cents])=>({plugin_id,name,price_cents,published:true,fulfillment_ready:true,commission_bps:0,version:1}));
const billing={catalog,settings:{enabled:false,version:1,tax_label:'Tax',tax_bps:0,fee_bps:0,fixed_fee_cents:0,order_expiry_hours:24,default_bank_account_id:null},orders:[],ledger:[],bankAccounts:[],refunds:[],receipts:[],summary:{}};
const action=`async form=>{window.__saved=Object.fromEntries(form);return {ok:true,message:'Saved fixture'}}`;
const stubs={
 'server-only':'',
 'next/link':`export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
 'next/form':`export default function Form({action,children,...props}){return <form action={action} {...props}>{children}</form>}`,
 'next/image':`export default function Image(props){return <img {...props}/>}`,
 'next/navigation':`export const notFound=()=>{throw Error('Unauthorized')};export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){window.__refresh=(window.__refresh||0)+1}});export const useSearchParams=()=>new URLSearchParams(location.search);`,
 '@/app/account/logout-button':`export const LogoutButton=()=>null;`,
 '@/components/submit-button':`export function SubmitButton({children,...props}){return <button {...props}>{children}</button>}`,
 '@/lib/platform-admin/permissions':`export const PLATFORM_ADMIN_PERMISSIONS={teamManage:'team.manage'};`,
 '@/lib/platform-admin/auth':`export const requirePlatformAdmin=async()=>({roleSlug:'platform_owner'});`,
 './admin-topbar':`export const AdminTopbar=()=>null;`,
 './admin-navigation':`export const AdminNavigation=()=>null;`,
 '@/lib/market-payments':`export const marketPaymentSettings=async()=>({booking_deposit_test_enabled:false});export const marketServiceClient=()=>({from(){return {select(){return this},order(){return this},limit(){return Promise.resolve({data:[],error:null})}}}});`,
 '@/lib/platform-payment':`export const paymentConfig=async()=>({enabled:false,mode:'test',version:0,keyConfigured:false,webhookConfigured:false,publishableKey:''});export const publicPayment=v=>v;export const PAYMENT_WEBHOOK='https://reylumi.com/api/payments/webhook';`,
 '@/lib/twilio-settings':`export const getTwilioSettings=async()=>({accountSid:'',verifyServiceSid:'',messagingServiceSid:'',from:'',enabled:false,claimSms:true,claimVoice:false,tokenConfigured:false});export const publicTwilioSettings=v=>v;`,
 '@/lib/support-email':`export const getSupportEmailConfig=async()=>({from:'support@reylumi.com',enabled:false,keyConfigured:false});export const publicSupportEmailConfig=v=>v;`,
 './billing-data':`export const loadMarketBillingAdminState=async()=>(${JSON.stringify(billing)});`,
 './billing-actions':`export const saveMarketBillingCatalog=${action};export const saveMarketBillingSettings=${action};`,
 './plugin-operations-actions':`export const saveMarketPluginOperations=${action};`,
 '../settings/support-email/actions':`export const saveSupportEmailSettingsAction=${action};`,
 './actions':`export const saveTwilioSettingsAction=async()=>({ok:true,message:'Saved fixture'});`,
 './system-actions':`export const savePaymentConnection=${action};export const reconcileCardPayment=${action};export const retryCardEvent=${action};export const refundCardInvoice=${action};`,
 './billing-workspace':`export const Orders=()=> <p>No historical orders in fixture.</p>;export const Ledger=()=> <p>No ledger entries in fixture.</p>;`,
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {MarketSystemWorkspace} from './app/(app)/admin/market/system-workspace';MarketSystemWorkspace().then(view=>createRoot(document.getElementById('root')).render(<div className="admin-workspace"><main className="admin-content">{view}</main></div>));`;
const result=await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,outdir:'artifacts/market-system',platform:'browser',jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixtures',setup(api){api.onResolve({filter:/.*/},args=>stubs[args.path]!==undefined?{path:args.path,namespace:'stub'}:undefined);api.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:root}));}}]});
const files=[];function scan(dir){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,item.name);if(item.isDirectory())scan(f);else if(f.endsWith('.css'))files.push(f)}}scan(path.join(root,'.next/static'));
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=files.map(f=>fs.readFileSync(f,'utf8')).filter(c=>c.includes('tailwindcss')).join('\n')+'\n'+fs.readFileSync(path.join(root,'app/(app)/admin/admin.css'),'utf8')+'\n'+result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+'\nbody{margin:0}.admin-content{padding:24px!important}.admin-workspace{min-height:100vh}';
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script>','<\\/script>')}</script></body></html>`)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('artifacts/market-system',{recursive:true});
try{
 const url='http://127.0.0.1:'+server.address().port+'/admin/settings';await page.goto(url);await page.getByRole('heading',{name:'Market & System'}).waitFor();
 assert.equal(await page.locator('#payment').getAttribute('open'),'');assert.equal(await page.getByLabel('Secret key',{exact:true}).inputValue(),'');
 await page.locator('#plugin-booking-policy>summary').click();const plugin=page.locator('#plugin-booking-policy');await plugin.getByLabel('Monthly price (USD)').fill('2.49');await plugin.getByRole('button',{name:'Save plugin',exact:true}).click();await page.waitForFunction(()=>window.__saved?.price==='2.49');assert.equal(await page.evaluate(()=>window.__saved.plugin_id),'booking-policy');assert.equal(page.url(),url);
 await page.locator('#email>summary').click();await page.locator('#email').getByLabel('Sender',{exact:true}).fill('help@reylumi.com');await page.locator('#email').getByRole('button',{name:'Save email',exact:true}).click();await page.waitForFunction(()=>window.__saved?.intent==='save');assert.equal(await page.evaluate(()=>window.__saved.from),'help@reylumi.com');
 await page.evaluate(()=>location.hash='messaging');await page.waitForFunction(()=>document.querySelector('#messaging').open);assert.equal(await page.getByLabel('Auth Token',{exact:true}).inputValue(),'');
 await page.locator('#messaging>summary').click();await page.locator('#email>summary').click();
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow at ${width}`);await page.screenshot({path:`artifacts/market-system/workspace-${width}.png`,fullPage:true});}
 await page.locator('#plugin-booking-policy>summary').click();await page.locator('#plugin-booking-policy>summary').focus();await page.keyboard.press('Enter');assert.equal(await plugin.getAttribute('open'),'');assert.equal(await plugin.getByLabel('Monthly price (USD)').inputValue(),'2.49');assert.deepEqual(errors,[]);
 console.log('PASS: actual list components at 1440/768/390px; direct editing/submission, no navigation, keyboard toggle, hash reveal, draft preservation, empty secret fields. Provider and historical data use fixtures.');
}finally{await browser.close();server.close();}
