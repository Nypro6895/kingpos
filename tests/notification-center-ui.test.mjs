import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
const esbuildPath = process.env.ESBUILD_MODULE_PATH;
test(
  "Notification visibility: hidden panel, five visible rows, scrolling, failure, retry and no page refresh",
  { timeout: 60000 },
  async () => {
    const { build } = await import(pathToFileURL(esbuildPath).href);
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {NotificationFeedList} from './app/notifications/notification-list';
 import {useNotificationSummary} from './lib/notification-client';
 window.calls=[];window.fail=false;window.errors=[];window.marked=new Set();
 window.addEventListener('kingpos:notifications-error',e=>window.errors.push(e.detail));
 const rows=Array.from({length:10},(_,i)=>({id:'app:'+String(i+1).padStart(8,'0')+'-0000-4000-8000-000000000000',title:'Update '+(i+1),body:'Appointment update',createdAt:new Date().toISOString(),kindLabel:'Booking',meta:'Just now',source:'app',status:'unread',unread:true,action:{type:'open-app',notificationId:String(i+1).padStart(8,'0')+'-0000-4000-8000-000000000000',href:'/my-bookings/'+i,workspaceId:null,label:'View appointment'}}));
 window.fetch=async(url,options)=>{window.calls.push({url,method:options?.method??'GET',body:options?.body?JSON.parse(options.body):null});if(window.fail)return new Response('{}',{status:503});if(options?.method==='POST'){JSON.parse(options.body).ids.forEach(id=>window.marked.add(id));return new Response('{}');}return Response.json({items:rows.slice(0,5),unreadCount:rows.filter(r=>r.unread).length,cursor:null});};
 const initial={previewItems:rows.slice(0,5),bookingNotifications:10,total:10,items:[],beautyPublicationRequests:0,managerApplications:0,staffApplications:0,staffInvites:0,reviewHref:'/notifications'};
 function App(){const summary=useNotificationSummary(initial,'fixture');return <><output id='badge'>{summary.total}</output><details id='panel'><summary>Notifications</summary><div id='scroll' style={{height:400,overflow:'auto'}}><NotificationFeedList items={rows.map(r=>({...r,unread:!window.marked.has(r.action.notificationId),status:window.marked.has(r.action.notificationId)?"read":"unread"}))}/></div></details><div style={{display:'none'}}><NotificationFeedList items={rows}/></div></>;}
 const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<App/>);window.render();
 `,
      },
      bundle: true,
      write: false,
      jsx: "automatic",
      plugins: [
        {
          name: "stubs",
          setup(b) {
            b.onResolve(
              { filter: /app\/(notifications|staff)\/actions$/ },
              () => ({ path: "actions", namespace: "stub" }),
            );
            b.onResolve({ filter: /^next\/link$/ }, () => ({
              path: "link",
              namespace: "stub",
            }));
            b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
              contents:
                args.path === "link"
                  ? `import React from 'react';export default function Link({children,href,...props}){return <a href={href}>{children}</a>}`
                  : `export async function runNotificationBookingAction(){return {ok:true}};export async function openAppNotificationAction(){};export async function acceptStaffInviteByRequestFormAction(){};export async function cancelStaffSalonApplicationFormAction(){};export async function declineStaffInviteByRequestFormAction(){}`,
              loader: "tsx",
              resolveDir: process.cwd(),
            }));
          },
        },
      ],
    });
    const script = result.outputFiles[0].text;
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<html><style>article{height:80px;box-sizing:border-box}button{border:0;background:white}span{display:block}</style><div id='root'></div><script>${script}</script></html>`,
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      channel: "msedge",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForTimeout(800);
      assert.equal(
        await page.evaluate(() => window.calls.length),
        0,
        "closed/hidden rows must not mark viewed",
      );
      await page.locator("#panel summary").click();
      await page.waitForTimeout(1000);
      const calls = await page.evaluate(() => window.calls);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.ids.length, 5);
      assert.equal(await page.locator("#badge").innerText(), "5");
      assert.equal(
        await page.locator('#scroll [aria-label="Unread"]').count(),
        5,
        "unseen five rows stay unread",
      );
      await page.evaluate(() => {
        window.fail = true;
        document.getElementById("scroll").scrollTop = 400;
      });
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(() => window.calls.length), 2);
      assert.equal(
        await page.locator('#scroll [aria-label="Unread"]').count(),
        5,
        "failed persistence must not pretend read",
      );
      assert.equal(await page.evaluate(() => window.errors.length), 1);
      await page.evaluate(() => {
        window.fail = false;
        window.render();
      });
      await page.waitForTimeout(1000);
      assert.equal(
        await page.locator('#scroll [aria-label="Unread"]').count(),
        0,
        "retry persists the visible rows",
      );
      assert.ok(
        (await page.evaluate(() => window.calls)).every(
          (c) => c.url === "/api/notifications",
        ),
        "no full-page loader",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);

test(
  "Notification preferences: saved defaults, independent toggle, failure keeps prior value",
  { timeout: 60000 },
  async () => {
    const { build } = await import(pathToFileURL(esbuildPath).href);
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
 import React from 'react';import {createRoot} from 'react-dom/client';import {NotificationPreferencesPanel} from './app/settings/notification-preferences-panel';
 window.saved=[];window.fail=false;window.fetch=async(url,options)=>{if(options?.method==='POST'){if(window.fail)return Response.json({error:'Save failed'},{status:503});window.saved.push(JSON.parse(options.body));return Response.json({ok:true});}return Response.json({preferences:{comments:false},checkInDefault:true});};
 createRoot(document.getElementById('root')).render(<NotificationPreferencesPanel/>);
 `,
      },
      bundle: true,
      write: false,
      jsx: "automatic",
      plugins: [
        {
          name: "link",
          setup(b) {
            b.onResolve({ filter: /^next\/link$/ }, () => ({
              path: "link",
              namespace: "stub",
            }));
            b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
              contents: `import React from 'react';export default function Link({children,href}){return <a href={href}>{children}</a>}`,
              loader: "tsx",
              resolveDir: process.cwd(),
            }));
          },
        },
      ],
    });
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<html><div id='root'></div><script>${result.outputFiles[0].text}</script></html>`,
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      channel: "msedge",
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const booking = page.getByRole("switch", {
        name: "Booking updates",
        exact: true,
      });
      await booking.waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[role="switch"]').disabled,
      );
      assert.equal(await booking.getAttribute("aria-checked"), "true");
      assert.equal(
        await page
          .getByRole("switch", { name: "Comments and replies", exact: true })
          .getAttribute("aria-checked"),
        "false",
      );
      assert.equal(
        await page
          .getByRole("switch", { name: "Salon check-in", exact: true })
          .getAttribute("aria-checked"),
        "true",
      );
      await booking.click();
      await page.waitForFunction(() => window.saved.length === 1);
      assert.equal(await booking.getAttribute("aria-checked"), "false");
      assert.deepEqual(await page.evaluate(() => window.saved), [
        { category: "booking", enabled: false },
      ]);
      await page.evaluate(() => (window.fail = true));
      await booking.click();
      await page.getByRole("alert").waitFor();
      assert.equal(await booking.getAttribute("aria-checked"), "false");
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);

test('Visible rows are recorded when returning from a hidden tab without scrolling', {timeout:60000},async()=>{
 const {build}=await import(pathToFileURL(esbuildPath).href);
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {NotificationFeedList} from './app/notifications/notification-list';
 window.calls=[];window.tabVisible=false;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.tabVisible?'visible':'hidden'});
 window.fetch=async(url,options)=>{window.calls.push(JSON.parse(options.body));return Response.json({});};
 const item={id:'app:00000001-0000-4000-8000-000000000000',title:'Arrived',body:'Your client has checked in',createdAt:new Date().toISOString(),kindLabel:'Arrival',meta:'Today',source:'app',status:'unread',unread:true,action:{type:'open-app',notificationId:'00000001-0000-4000-8000-000000000000',href:'/notifications/visits/visit',workspaceId:null,label:'View visit'}};
 createRoot(document.getElementById('root')).render(<NotificationFeedList items={[item]}/>);
 `},bundle:true,write:false,jsx:'automatic',plugins:[{name:'stubs',setup(b){b.onResolve({filter:/app\/(notifications|staff)\/actions$/},()=>({path:'actions',namespace:'stub'}));b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='link'?`import React from 'react';export default function Link({children,href}){return <a href={href}>{children}</a>}`:`export async function runNotificationBookingAction(){return {ok:true}};export async function openAppNotificationAction(){};export async function acceptStaffInviteByRequestFormAction(){};export async function cancelStaffSalonApplicationFormAction(){};export async function declineStaffInviteByRequestFormAction(){}`,loader:'tsx',resolveDir:process.cwd()}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><div id='root'></div><script>${result.outputFiles[0].text}</script></html>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>window.calls.length),0);
 await page.evaluate(()=>{window.tabVisible=true;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.calls.length),1);assert.equal(await page.getByLabel('Unread').count(),0);
 await page.evaluate(()=>{window.tabVisible=false;document.dispatchEvent(new Event('visibilitychange'));window.tabVisible=true;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>window.calls.length),1,'already viewed row must not be recorded twice');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
