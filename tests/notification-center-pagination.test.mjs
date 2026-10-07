import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

test(
  "Notification center automatically paginates on scroll without duplicates and ignores stale filter responses",
  { timeout: 60000 },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
    );
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
 import React from 'react';import {createRoot} from 'react-dom/client';import {NotificationCenterClient} from './app/notifications/notification-center-client';
 const make=(i)=>({id:'app:'+String(i).padStart(8,'0')+'-0000-4000-8000-000000000000',title:'Update '+i,body:'Appointment update',createdAt:'2026-10-01T10:00:00Z',kindLabel:'Booking',meta:'Today',source:'app',status:'read',unread:false,action:{type:'open-app',notificationId:String(i).padStart(8,'0')+'-0000-4000-8000-000000000000',href:'/my-bookings/'+i,workspaceId:null,label:'View'}});
 window.calls=[];window.delayUnread=true;window.fail=false;
 window.fetch=async(url,options)=>{window.calls.push({url,method:options?.method??'GET'});if(options?.method==='POST')return Response.json({});if(window.fail)return Response.json({error:'Load failed'},{status:503});const params=new URL(url,location.origin).searchParams;
 if(params.get('id')){await new Promise(r=>setTimeout(r,100));return Response.json({items:[make(2),make(3)],cursor:null});}
 if(params.get('filter')==='unread'&&window.delayUnread)return await new Promise(r=>window.finishUnread=()=>r(Response.json({items:[make(7)],cursor:null})));
 return Response.json({items:[make(9)],cursor:null});};
 createRoot(document.getElementById('root')).render(<NotificationCenterClient initialItems={[make(1),make(2)]} initialCursor={{at:'2026-10-01T10:00:00Z',id:'00000002-0000-4000-8000-000000000000'}} actionItems={[]}/>);
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
                  ? `import React from 'react';export default function Link({children,href}){return <a href={href}>{children}</a>}`
                  : `export async function runNotificationBookingAction(){return {ok:true}};export async function openAppNotificationAction(){};export async function acceptStaffInviteByRequestFormAction(){};export async function cancelStaffSalonApplicationFormAction(){};export async function declineStaffInviteByRequestFormAction(){}`,
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
        `<html><style>article{min-height:200px}</style><div id='root'></div><script>${result.outputFiles[0].text}</script></html>`,
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      channel: "msedge",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 200 },
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page
        .getByRole("button", { name: "Load older notifications" })
        .waitFor();
      await page
        .getByRole("button", { name: "Load older notifications" })
        .scrollIntoViewIfNeeded();
      await page.getByText("Update 3", { exact: true }).waitFor();
      assert.equal(await page.locator("[data-notification-id]").count(), 3);
      assert.equal(await page.evaluate(() => window.calls.length), 1);
      await page.getByRole("button", { name: "Unread", exact: true }).click();
      await page.waitForFunction(() => Boolean(window.finishUnread));
      await page.getByRole("button", { name: "All", exact: true }).click();
      await page.getByText("Update 9", { exact: true }).waitFor();
      await page.evaluate(() => window.finishUnread());
      await page.waitForTimeout(100);
      assert.equal(
        await page.getByText("Update 7", { exact: true }).count(),
        0,
        "stale unread response must not replace All",
      );
      await page.evaluate(() => {
        window.fail = true;
        window.delayUnread = false;
      });
      await page.getByRole("button", { name: "Unread", exact: true }).click();
      await page.getByRole("alert").waitFor();
      await page.evaluate(() => (window.fail = false));
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector('[role="alert"]'),
      );
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
