import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { transformSync } from 'esbuild';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { workspaceFiles, copyOccurrences } from '../scripts/workspace-copy-catalog.mjs';

const mod = {exports:{}};
new Function('module','exports','require',transformSync(fs.readFileSync('lib/vietnamese-dictionary.ts','utf8'),{loader:'ts',format:'cjs'}).code)(mod,mod.exports,s=>JSON.parse(fs.readFileSync(s.replace('@/',''),'utf8')));
const {VIETNAMESE_UI:copy,translateVietnamese:t} = mod.exports;
const maps = fs.readdirSync('lib').filter(f=>/^vietnamese-.*\.json$/.test(f));
const baseline = '012458422ae0fe665b3cbd390a45fe302e9f891c';

test('rendered dictionary resolves roles, toggles, missing information and common salon actions',()=>{
  const examples = {
    Staff:'Nhân viên',Professional:'Nhân viên',Professionals:'Nhân viên',
    Off:'Tắt',off:'Tắt',On:'Bật',on:'Bật',Missing:'Còn thiếu',You:'Bạn',
    'Online booking off':'Đã tắt đặt lịch trực tuyến',
    'Book with professional':'Đặt lịch với nhân viên',
    Break:'Nghỉ giải lao',Bio:'Giới thiệu bản thân',
    'Check Out':'Kết thúc ca','Check amount':'Số tiền trên séc',
    'Custom tip':'Tiền tip tùy chỉnh','Take-home pay':'Thu nhập thực nhận',
    'Tax cash':'Tính thuế lương tiền mặt','Tax tip':'Tính thuế tiền tip',
    'Tax bonus':'Tính thuế tiền thưởng','Sign up':'Đăng ký',
  };
  for(const [key,expected] of Object.entries(examples)) assert.equal(t(key,true),expected,key);
});

test('profile copy distinguishes public pages and internal staff/customer records',()=>{
  assert.equal(t('Profile',true),'Trang cá nhân');
  assert.equal(t('Salon profile',true),'Trang tiệm');
  assert.equal(t('Staff profile',true),'Hồ sơ nhân viên');
  assert.equal(t('Customer profile',true),'Hồ sơ khách hàng');
  assert.equal(t('Public staff profile · photo, bio & specialties',true),'Trang giới thiệu nhân viên · Ảnh, giới thiệu bản thân và chuyên môn');
  assert.match(fs.readFileSync('app/role-navigation.ts','utf8'),/id: "owner-profile", label: "Salon profile"/);
  assert.match(fs.readFileSync('app/staff/staff-directory-editor.tsx','utf8'),/WorkspaceText text="Staff profile"/);
});

test('templates preserve names and financial amounts and omit English plural suffixes',()=>{
  assert.equal(t('Book with Today Salon',true),'Đặt lịch với Today Salon');
  assert.equal(t('3 professionals',true),'3 nhân viên');
  assert.equal(t('3 professionals available',true),'3 nhân viên còn trống lịch');
  assert.equal(t('1 professional available',true),'1 nhân viên còn trống lịch');
  assert.equal(t('3 bookings need review',true),'3 lịch hẹn cần xem lại');
  assert.equal(t('Over $1,234.56',true),'Dư $1,234.56');
  assert.equal(t('Short $7.25',true),'Thiếu $7.25');
  assert.equal(t('$10.00 USD',true),'$10.00 USD');
  assert.equal(t('Device: Today Salon.',true),'Thiết bị: Today Salon.');
  assert.equal(t('17 unread notifications',true),'17 thông báo chưa đọc');
  assert.equal(t('3 days ago',true),'3 ngày trước');
});

test('free text, identifiers, disabled translations and real tax professionals retain their meanings',()=>{
  for(const value of ['Emily Smith / Gel-X / $39.99','Customer note: Book with Amy, no tip today.','salon_profile.content.manage']) assert.equal(t(value,true),value);
  assert.equal(t('Save changes',false),'Save changes');
  assert.match(t('Bring organized salon records to your chosen tax professional.',true),/chuyên gia thuế/);
  assert.equal(t('Type "DELETE" to confirm the account deletion request.',true),'Nhập "DELETE" để xác nhận yêu cầu xóa tài khoản.');
});

test('JSX-decoded apostrophes and arrows resolve only through known UI keys',()=>{
  assert.equal(t("You're all caught up",true),'Bạn đã xem hết cập nhật');
  assert.equal(t("Your salon's booking rules",true),'Quy định đặt lịch của tiệm');
  assert.equal(t('View all services ->',true),'Xem tất cả dịch vụ →');
  assert.equal(t("Amy's appointment & special notes",true),"Amy's appointment & special notes");
});

test('all JSON dictionaries preserve original keys and every meaningful interpolation',()=>{
  const pluralOnly = new Set([
    '{0} bookable service{1}','{0} booking{1} need review','{0} closed ticket{1}',
    '{0} day{1} ago','{0} online service{1}','{0} open POS ticket{1}',
    '{0} owned salon{1} found. {2} require transfer or no-transfer closure before deletion can be scheduled.',
    '{0} professional{1} available','{0} professional{1} with hours','{0} waiting client{1}',
  ]);
  for(const file of maps){
    const relative='lib/'+file;
    let before;
    try{before=JSON.parse(execFileSync('git',['show',`${baseline}:${relative}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));}
    catch{before={};}
    const after=JSON.parse(fs.readFileSync(relative,'utf8'));
    for(const key of Object.keys(before))assert.ok(Object.hasOwn(after,key),relative+': removed '+key);
    for(const [key,value] of Object.entries(after)){
      assert.equal(typeof value,'string',key);assert.ok(value.trim(),key);
      if(value===before[key])continue;
      for(const slot of (before[key]??key).match(/\{\d+\}/g)||[]) if(!(slot==='{1}'&&pluralOnly.has(key))) assert.ok(value.includes(slot),`${relative}: lost ${slot} in ${key}`);
      for(const slot of value.match(/\{\d+\}/g)||[]) assert.ok(key.includes(slot),`${relative}: invented ${slot} in ${key}`);
    }
  }
});

test('none of the known absurd translations survive in the loaded UI dictionary',()=>{
  for(const [key,value] of Object.entries(copy)){
    assert.doesNotMatch(value,/ra khơi|mất tích|\bMày\b|Địa ngục|đập vỡ|cây trồng|khe cắm|bàn chân Deluxe|đặt chân trời/iu,key);
    if(/\bprofessionals?\b/i.test(key)&& !/tax|terms|advice|engagement|supplies|fees/i.test(key)) assert.doesNotMatch(value,/chuyên gia|chuyên nghiệp/i,key);
    if(/\btips?\b/i.test(key)) assert.doesNotMatch(value,/mẹo|lời khuyên/i,key);
  }
});

test('all UI copy recognized by the workspace catalog has a dictionary entry',()=>{
  const missing=workspaceFiles().flatMap(copyOccurrences).filter(row=>!copy[row.text]);
  assert.deepEqual(missing,[]);
});

test('customer form renders Vietnamese, preserves submitted user data and switches back to English',async()=>{
  const executablePath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert.ok(fs.existsSync(executablePath),'A real browser is required for this acceptance check');
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{WorkspaceLanguageProvider,WorkspaceText}from'./components/workspace-language';
    import{CustomerForm}from'./app/customers/customer-form';
    function App(){const[enabled,setEnabled]=useState(true);return <><button id="toggle" onClick={()=>setEnabled(!enabled)}>Switch language</button><WorkspaceLanguageProvider enabled={enabled} portableEnabled={enabled} expiresAt={null}>
      <h1><WorkspaceText text="Customers"/></h1>
      <p id="book"><WorkspaceText text="Book with Today Salon"/></p>
      <p id="off"><WorkspaceText text="Off"/></p>
      <p id="professional"><WorkspaceText text="Professionals"/></p>
      <p id="missing"><WorkspaceText text="Missing"/></p>
      <CustomerForm mode="edit" customer={{id:'test',name:'Today',phone:'3125550199',email:'test@example.com',notes:'Book with Amy. No tip today.',staff_notes:'Keep staff note',internal_notes:'Keep owner note',status:'active'}} action={async data=>{window.submitted=Object.fromEntries(data)}}/>
    </WorkspaceLanguageProvider></>};createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'local-boundaries',setup(b){
    b.onResolve({filter:/^(next\/navigation|next\/link|.*\.module\.css|.*customers\/actions|\.\/actions)$/},a=>({path:a.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.endsWith('/actions')?'export const searchCustomerMatches=async()=>[];':a.path.includes('navigation')?'export const usePathname=()=>location.pathname;':a.path.includes('link')?`import React from 'react';export default function Link(p){return React.createElement('a',p)}`:'export default {};',resolveDir:process.cwd(),loader:'js'}));
  }}]});
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    for(const route of ['/customers','/staff/today','/pos/portable','/explore']){
      const page=await browser.newPage({viewport:{width:390,height:844}});
      page.setDefaultTimeout(7000);
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
      const excluded=route==='/explore';
      await page.getByRole('heading',{name:excluded?'Customers':'Khách hàng',exact:true}).waitFor();
      assert.equal(await page.locator('#book').textContent(),excluded?'Book with Today Salon':'Đặt lịch với Today Salon');
      assert.equal(await page.locator('#off').textContent(),excluded?'Off':'Tắt');
      assert.equal(await page.locator('#professional').textContent(),excluded?'Professionals':'Nhân viên');
      assert.equal(await page.locator('#missing').textContent(),excluded?'Missing':'Còn thiếu');
      await page.getByRole('button',{name:excluded?'Save Customer':'Lưu khách hàng',exact:true}).click();
      await page.waitForFunction(()=>Boolean(window.submitted));
      const data=await page.evaluate(()=>window.submitted);
      assert.equal(data.name,'Today');assert.equal(data.notes,'Book with Amy. No tip today.');
      assert.equal(data.status,'active');assert.equal(data.staff_notes,'Keep staff note');
      if(!excluded){await page.locator('#toggle').click();await page.getByRole('heading',{name:'Customers',exact:true}).waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'Today');}
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
