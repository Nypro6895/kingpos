import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(path,stubs={}) {
  const module={exports:{}};
  const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const require=id=>{
    if(Object.hasOwn(stubs,id))return stubs[id];
    if(id==='react')return React;
    if(id==='react/jsx-runtime')return jsx;
    throw Error(`Missing dependency ${id}`);
  };
  new Function('require','module','exports',compiled)(require,module,module.exports);
  return module.exports;
}

test('owner, staff and personal shells render page content once with both navigation slots',()=>{
  const role=load('app/role-navigation.ts');
  const routes=load('lib/routes.ts');
  const context=load('app/customer-shell-context.tsx');
  let pathname='/services';
  const summary={items:[],previewItems:[],reviewHref:'/notifications',total:0,bookingNotifications:0,beautyPublicationRequests:0,managerApplications:0,staffApplications:0,staffInvites:0};
  const {NavigationShell}=load('app/navigation-shell.tsx',{
    '@/app/account/logout-button':{LogoutButton:()=>null},'@/app/action-dialog':{ActionDialog:()=>null},
    '@/app/customer-shell-context':context,'@/app/notifications/notification-list':{NotificationFeedList:()=>null},
    '@/app/quick-workspace-panel':{QuickWorkspacePanel:()=>null},'@/lib/account-avatar':{safeAccountAvatarUrl:()=>null},
    '@/lib/supabase/browser':{createSupabaseBrowserClient:()=>null},'@/app/role-navigation':role,
    '@/app/salons/actions':{},'@/lib/routes':routes,
    '@/lib/notification-client':{useNotificationSummary:initial=>initial},
    'next/navigation':{usePathname:()=>pathname,useSearchParams:()=>new URLSearchParams(),useRouter:()=>({})},
    'next/link':{__esModule:true,default:({children,href,prefetch,...props})=>React.createElement('a',{href,...props},children)},
    'next/image':{__esModule:true,default:({alt,src,width,height,className})=>React.createElement('img',{alt,src,width,height,className})},
  });
  for(const [path,mode,type] of [['/services','manage','salon'],['/staff/my-work','staff','salon'],['/my-bookings',null,'personal']]){
    pathname=path;
    const workspace={id:mode?`${mode}:salon`:'personal',type,salonMode:mode,salonName:'Fixture Salon',label:'Fixture account',roleLabel:mode==='staff'?'Staff':'Owner'};
    const html=renderToStaticMarkup(React.createElement(NavigationShell,{
      accountLabel:'Fixture user',accountAvatarUrl:null,accountEmail:null,currentUserId:null,
      currentWorkspace:workspace,salonMode:mode,workspaceType:type,workspaceOptions:[workspace],workspaceSections:[],
      notificationSummary:summary,children:React.createElement('main',{'data-page-probe':true},'Unfinished page state'),
    }));
    assert.equal((html.match(/data-page-probe/g)||[]).length,1,path);
    assert.ok(html.includes('data-desktop-sidebar-slot'));assert.ok(html.includes('Customer')||html.includes('Owner')||html.includes('Staff'));
  }
});

test('report refresh loads only the requested tab and rejects unauthorized reads',async()=>{
  const calls=[];let permitted=true;
  const context={user:{id:'user'},currentSalon:{id:'salon'}};
  const {GET}=load('app/api/pos/owner/reports/route.ts',{
    'next/server':{NextResponse:class extends Response{static json(data,options){return Response.json(data,options);}}},
    '@/lib/current-context':{getCurrentBusinessContext:async()=>context,isSalonManageContext:()=>true},
    '@/lib/permissions':{hasPermission:async()=>permitted},
    '@/lib/daily-pos-report':{getDailyPosReport:async()=>{calls.push('closing');return {lock:{isLocked:false}};},canEditDailyPosClosing:async()=>true,canApplyFinancialCorrections:async()=>true},
    '@/lib/operational-report':{getOperationalReport:async()=>{calls.push('overview');return {range:{}};}},
  });
  const overview=await (await GET(new Request('https://fixture.test/reports?view=overview'))).json();
  assert.deepEqual(calls,['overview']);assert.ok(overview.reportOverview);assert.equal(overview.report,undefined);
  calls.length=0;
  const closing=await (await GET(new Request('https://fixture.test/reports?view=closing'))).json();
  assert.deepEqual(calls,['closing']);assert.ok(closing.report);assert.equal(closing.reportOverview,undefined);
  permitted=false;calls.length=0;
  assert.equal((await GET(new Request('https://fixture.test/reports?view=overview'))).status,401);assert.equal(calls.length,0);
});

test('booking calendar refresh requests a scoped detail patch and omits server identity context',async()=>{
  let options;
  const {GET}=load('app/api/pos/owner/bookings/route.ts',{
    'next/server':{NextResponse:class extends Response{static json(data,init){return Response.json(data,init);}}},
    '@/lib/current-context':{getCurrentBusinessContext:async()=>({user:{id:'user'},currentSalon:{id:'salon'}}),isSalonManageContext:()=>true},
    '@/lib/permissions':{hasPermission:async()=>true},
    '@/lib/bookings':{BOOKING_PERMISSIONS:{view:'booking.view'},getCurrentSalonBookingWorkspace:async(_params,_context,refresh)=>{
      options=refresh;return {context:{private:'identity'},bookings:[],requests:[],options:{timeBlocks:[],customers:[{id:'irrelevant-customer'}]}};
    }},
  });
  const id='00000000-0000-4000-8000-000000000001';
  const body=await (await GET(new Request(`https://fixture.test/bookings?resource=calendar&ids=${id},invalid`))).json();
  assert.equal(options.detailOnly,true);assert.deepEqual(options.ids,[id]);
  assert.deepEqual(Object.keys(body.workspace).sort(),['bookings','requests','timeBlocks']);
  const full=await (await GET(new Request('https://fixture.test/bookings'))).json();
  assert.equal(full.workspace.context,undefined);
});
