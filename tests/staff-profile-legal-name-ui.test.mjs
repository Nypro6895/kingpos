import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('Staff legal name preserves First/Last boundaries on save; Payroll shows profile name without an independent editor', {timeout:60000},async()=>{
 const dir='artifacts/staff-profile-legal-name-20261029/browser';fs.mkdirSync(dir,{recursive:true});
 const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{StaffDirectoryEditor}from'@/app/staff/staff-directory-editor';import{StaffPayrollSettingInlineEdit}from'@/app/payroll/staff-payroll-setting-inline-edit';
 const staff={id:'ny',display_name:'Staff-Ny',first_name:'Ny',last_name:'Truong',phone:'555-0100',email:'staff@example.test',is_active:true,pos_enabled:true,online_booking_enabled:true,passcode_is_default:true};
 const status={booking:{label:'',tone:'neutral'},payroll:{label:'',tone:'neutral'}};
 function App(){return <main><h1>Staff</h1><StaffDirectoryEditor activeStaff={[staff]} hiddenStaff={[]} addHref="/staff?add=1" canManageStaff hasAnyStaff query="" profileHrefByStaffId={{}} statusByStaffId={{ny:status}}/><section id="payroll"><h1>Payroll</h1><StaffPayrollSettingInlineEdit staff={staff} staffProfileDisplayName="Staff-Ny" staffProfileAvatarUrl={null} setting={{legal_name:'Wrong legacy name',effective_from:'2026-10-01'}} period={{startDate:'2026-10-01',endDate:'2026-10-15'}} returnPath="/payroll"/></section></main>};createRoot(document.getElementById('root')).render(<App/>);`;
 const mocks={
 '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`,
 'next/link':`import React from 'react';export default function Link(props){return <a {...props}/>}`,
 '@/app/staff/actions':`export async function saveStaffDirectoryEntryAction(form){window.savedForm=Object.fromEntries(form);return {ok:true}};export async function resetStaffPasscodeFormAction(){}`,
 '@/app/payroll/actions':`export async function saveStaffPayrollSettingWithEffectiveDateAction(){}`,
 '@/app/settings/delete-unused-button':`export const DeleteUnusedButton=()=>null;`,
 '@/components/submit-button':`import React from 'react';export function SubmitButton({children,pendingLabel,...props}){return <button {...props} type="submit">{children}</button>}`,
 };
 await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:dir+'/fixture.js',jsx:'automatic',plugins:[{name:'offline',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'offline'}:undefined);b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
 const css=await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./app/staff/staff-directory-editor.tsx";\n@source "./app/payroll/staff-payroll-setting-inline-edit.tsx";',{from:process.cwd()+'/fixture.css'});fs.writeFileSync(dir+'/fixture.css',css.css);
 const html='<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font-family:Arial;background:white;color:#18181b}main{padding:16px;max-width:700px;margin:auto}h1{font-size:20px;font-weight:600;margin:12px 0}#payroll{margin-top:40px}</style><div id="root"></div><script src="/fixture.js"></script>';
 const server=createServer((req,res)=>{if(['/fixture.js','/fixture.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(dir+req.url));}else{res.setHeader('Content-Type','text/html');res.end(html)}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});for(const width of [390,768]){const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('form',{name:'Edit staff'}).waitFor();const form=page.getByRole('form',{name:'Edit staff'});assert.ok((await form.innerText()).includes('Legal name'));await form.getByLabel('Last',{exact:true}).fill('Truong Nguyen');await form.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.savedForm?.last_name_ny==='Truong Nguyen');assert.equal(await page.evaluate(()=>window.savedForm.first_name_ny),'Ny');assert.equal(await page.evaluate(()=>window.savedForm.display_name_ny),'Staff-Ny');const payroll=page.locator('#payroll');assert.ok((await payroll.innerText()).includes('Ny Truong'));assert.ok(!(await payroll.innerText()).includes('Wrong legacy name'));assert.equal(await payroll.locator('input[name="legal_name"]').count(),0);await payroll.locator('summary').click();assert.equal(await payroll.getByRole('link',{name:'Edit staff'}).count(),1);await page.getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await form.getByLabel('Last',{exact:true}).inputValue(),'Truong Nguyen');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:dir+'/staff-payroll-'+width+'.png',fullPage:true});await page.close();}}finally{await browser?.close();await new Promise(r=>server.close(r));}
});
