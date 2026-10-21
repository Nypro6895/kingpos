import {build} from 'esbuild';

import {createServer} from 'node:http';

export async function campaignOwnerStatusFixture() {

  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{CampaignWorkspace}from'./app/campaigns/campaign-workspace';

    const base={salon_id:'salon',source_type:'custom',source_id:'creative',area:'city',location:'Milwaukee',country:'US',state:'WI',city:'Milwaukee',days:10,daily_views:100,daily_price_cents:10,total_price_cents:100,views:7,likes:1,comments:0,bookings:0,spent_cents:20,reserved_credits:100,released_credits:0,cycle_credit_limit:100,created_at:'2020-01-01T00:00:00Z',starts_at:'2020-01-01T00:00:00Z',ends_at:'2099-01-01T00:00:00Z',keep_running:false,owner_paused_at:null,pause_episode_id:null,pause_origin:null,payment_reference:'credits:fixture',approved_at:'2020-01-01T00:00:00Z'};

    window.ownerCampaignRows=[

      {...base,id:'expired-running',title:'Expired running',status:'running',ends_at:'2000-01-01T00:00:00Z'},

      {...base,id:'expired-paused',title:'Expired paused',status:'paused',starts_at:'1999-12-01T00:00:00Z',ends_at:'2000-01-01T00:00:00Z',owner_paused_at:'1999-12-31T00:00:00Z',pause_episode_id:'33333333-3333-4333-8333-000000000001',pause_origin:'owner'},

      {...base,id:'expired-renew',title:'Expired renewal',status:'running',ends_at:'2000-01-01T00:00:00Z',keep_running:true},

      {...base,id:'current-running',title:'Current running',status:'running'},

      {...base,id:'current-paused',title:'Current paused',status:'paused',owner_paused_at:'2020-01-01T00:00:00Z',pause_episode_id:'33333333-3333-4333-8333-000000000002',pause_origin:'owner'},

      {...base,id:'admin-paused',title:'Admin paused',status:'paused'},

      {...base,id:'scheduled',title:'Scheduled campaign',status:'running',starts_at:'2098-01-01T00:00:00Z'},

      {...base,id:'settled-paused',title:'Settled paused',status:'completed',released_credits:80,ends_at:'2000-01-01T00:00:00Z',owner_paused_at:'2000-01-01T00:00:00Z',pause_episode_id:'33333333-3333-4333-8333-000000000003',pause_origin:'owner'},

      {...base,id:'completed',title:'Completed campaign',status:'completed',ends_at:'2000-01-01T00:00:00Z'}

    ];window.ownerCampaignActions=[];window.ownerCampaignReads=[];

    window.ownerWallet={available_credits:500,reserved_credits:100,welcome_credits:0,installed:true,auto_topup_enabled:false,topup_credits:500,threshold_credits:100,monthly_limit_cents:3000,payment_ready:false,has_payment_method:false};

    createRoot(document.getElementById('root')).render(<CampaignWorkspace initialCampaigns={window.ownerCampaignRows} initialActive={window.ownerCampaignRows.filter(c=>c.status!=='completed'||c.owner_paused_at)} initialError='' wallet={window.ownerWallet}/>);`;

  const mocks = `import React from 'react';

    export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;

    export const WorkspaceNavigationIcon=()=>null;

    export const useRouter=()=>({refresh(){window.ownerCampaignReads.push('router.refresh')}});

    export const OwnerCampaignDialog=({onClose})=><div data-testid='run-again-dialog'><button onClick={onClose}>Close new campaign</button></div>;

    export const CreateCampaign=()=>null;export const CreditPanel=()=>null;export const CampaignResults=()=>null;export const CampaignPreview=()=>null;

    export async function loadOwnerCampaignsAction(offset=0,activeOnly=false){window.ownerCampaignReads.push({name:'campaigns',activeOnly});return{campaigns:window.ownerCampaignRows.filter(c=>!activeOnly||['running','paused','pending_review','awaiting_payment'].includes(c.status)||Boolean(c.owner_paused_at)),hasMore:false};}

    export async function campaignWalletAction(){window.ownerCampaignReads.push({name:'wallet'});return window.ownerWallet;}

    export async function changeOwnerCampaignAction(id,action,episode,resumeIntent){window.ownerCampaignActions.push({id,action,episode:episode??null,resumeIntent:resumeIntent??null});const c=window.ownerCampaignRows.find(c=>c.id===id);if(action==='resume'&&Date.parse(c.ends_at)<=Date.now()&&!c.owner_paused_at)throw Error('Unpaused expired campaign cannot resume');if(action==='resume'&&Date.parse(c.ends_at)<=Date.now())c.ends_at='2099-01-01T00:00:00Z';c.status=action==='cancel'?'cancelled':action==='pause'?'paused':'running';c.owner_paused_at=action==='pause'?'2020-01-01T00:00:00Z':null;c.pause_episode_id=action==='pause'?'33333333-3333-4333-8333-000000000004':null;return{ok:true,message:'Campaign updated.'};}

    export async function saveCampaignLimitAction(id,limit,keep){window.ownerCampaignActions.push({id,action:'settings',limit,keep});return{ok:true,message:'Settings saved.'};}

    export async function fundSavedCampaignAction(){throw Error('Funding is not exercised in this fixture');}

    export async function loadCampaignPostsAction(){return[];}

  `;

  const output = await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},alias:{'@':process.cwd()},plugins:[{name:'closed-owner-status-fixture',setup(builder){

    builder.onResolve({filter:/^next\/navigation$|^@\/components\/(workspace-language|workspace-navigation-icon|owner-campaign-dialog)$|^\.\/(actions|credit-actions|create-campaign|credit-panel|campaign-results|campaign-preview)$/},args=>({path:args.path,namespace:'mock'}));

    builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mocks,loader:'tsx',resolveDir:process.cwd()}));

  }}]});

  const js=output.outputFiles.find(file=>file.path.endsWith('.js')).text,css=output.outputFiles.find(file=>file.path.endsWith('.css')).text;

  const server=createServer((request,response)=>{

    if(request.url==='/fixture.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(js);return;}

    if(request.url?.startsWith('/api/')){response.writeHead(500);response.end('No API permitted');return;}

    response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});

    response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'"><style>body{font:16px Arial,sans-serif;margin:0;padding:16px;background:#f8fafc}*{box-sizing:border-box}button{min-height:44px}${css}</style><div id="root"></div><script src="/fixture.js"></script>`);

  });

  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

  return{url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};

}

