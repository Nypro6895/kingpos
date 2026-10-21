import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';

// The destination/feed functions are real; only the workspace context dependency
// is replaced. Delivery eligibility and current-owner selection remain SQL tests.
const bundle=await build({entryPoints:['lib/notification-feed-items.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'workspace-id-only',setup(builder){
  builder.onResolve({filter:/^@\/lib\/current-context$/},()=>({path:'context',namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const getManageWorkspaceId=id=>`manage:${id}`;export const getStaffWorkspaceId=id=>`staff:${id}`;',loader:'js'}));
}}]});
const {resolveAppNotificationDestination,appNotificationToFeedItem}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sql=fs.readFileSync('supabase/migrations/20261021070000_campaign_pause_lifecycle.sql','utf8');
const title=sql.match(/'owner_manager'\s*,\s*'campaign_pause_reminder'\s*,\s*'([^']+)'/)?.[1];
const hrefPrefix=sql.match(/'(\/campaigns[^']*)'\s*\|\|\s*c\.id/)?.[1];
const bodies=[...sql.matchAll(/'(Your campaign has been paused for [^']+)'/g)].map(match=>match[1]);
const salon='10000000-0000-0000-0000-000000000001',campaign='20000000-0000-0000-0000-000000000001';

test('actual pause-reminder feed payload opens Campaigns in its owner manage workspace',()=>{
  assert.ok(title&&hrefPrefix,'read notification literals from actual pause migration');
  assert.equal(bodies.length,2,'actual 24h and 7d reminder bodies');
  for(const [index,body] of bodies.entries()){
    const notification={id:'reminder-'+index,recipient_user_id:'current-lifecycle-owner',recipient_kind:'owner_manager',salon_id:salon,notification_type:'campaign_pause_reminder',title,body,href:hrefPrefix+campaign,created_at:'2026-10-21T12:00:00Z',read_at:null,thumbnail_url:null};
    const destination=resolveAppNotificationDestination(notification);
    assert.deepEqual(destination,{href:'/campaigns?campaign='+campaign,label:'Open',workspaceId:'manage:'+salon});
    const item=appNotificationToFeedItem(notification,new Date('2026-10-21T12:01:00Z'));
    assert.equal(item.title,title);assert.equal(item.body,body);assert.equal(item.unread,true);
    assert.equal(item.notificationType,'campaign_pause_reminder');
    assert.deepEqual(item.action,{href:destination.href,label:'Open',notificationId:notification.id,type:'open-app',workspaceId:'manage:'+salon});
    assert.ok(item.body.includes('stays paused until you choose Resume'),'notice does not imply automatic resume');
  }
});

test('Campaign destination does not manufacture owner context for other recipients or unsafe URLs',()=>{
  const base={id:'notice',recipient_kind:'owner_manager',salon_id:salon,notification_type:'campaign_pause_reminder',href:'/campaigns?campaign='+campaign};
  for(const recipient_kind of ['staff','customer'])assert.equal(resolveAppNotificationDestination({...base,recipient_kind}).workspaceId,null);
  assert.equal(resolveAppNotificationDestination({...base,salon_id:null}).workspaceId,null);
  for(const href of ['https://outside.example/campaigns','//outside.example/campaigns']){
    assert.deepEqual(resolveAppNotificationDestination({...base,href}),{href:'/notifications',label:'Open',workspaceId:null});
  }
});
