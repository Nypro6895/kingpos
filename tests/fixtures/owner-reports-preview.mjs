import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

// Actual OwnerLiveReports, DailyClosingForm and save hook, with isolated sample data.
// Only navigation, report refresh and the network boundary are replaced.
export async function ownerReportsPreview() {
  const bundle = await build({write:false, bundle:true, platform:'browser', format:'iife', outfile:'reports-preview.js', jsx:'automatic',
    stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {OwnerLiveReports} from './app/reports/owner-live-reports';
      import {WorkspaceLanguageProvider} from './components/workspace-language';
      const q=new URLSearchParams(location.search), locked=q.has('locked'), readonly=q.has('readonly');
      const zero=q.has('zero');
      const date=locked?'2026-10-22':'2026-10-23';
      const closingInputs={cashAmount:zero?0:locked?380:420, creditCardAmount:zero?0:locked?1120:1250, otherAmount:zero?0:locked?0:30,note:'',status:locked?'auto_locked':'draft',approvedAt:null,closedAt:null};
      let current={revision:1,reportDate:date,locked,closingInputs};
      let receipts=new Map();let firstFailure=true;
      window.previewRequests=[];
      window.previewSave=async(payload)=>{
        const values={cashAmount:Number(payload.cashAmount||0),creditCardAmount:Number(payload.creditCardAmount||0),otherAmount:Number(payload.otherAmount||0),note:payload.note?.trim()||null};
        window.previewRequests.push({values,expectedClosing:payload.expectedClosing,expectedScope:payload.expectedScope,reportDate:payload.reportDate,rawPayload:payload});
        if(q.get('save')==='conflict')throw Error('Closing amounts changed on another screen.');
        current={...current,closingInputs:{...closingInputs,...values}};
        if(q.get('save')==='unknown'&&firstFailure){firstFailure=false;throw Error('Simulated lost response');}
        return{ok:true,closingInputs:current.closingInputs};
      };
      window.fetch=async(url)=>{
        if(!String(url).startsWith('/api/pos/owner/reports'))throw Error('Unexpected request: '+url);
        return Response.json({closingScope:'preview-salon:preview-viewer',report:{...report,closingInputs:current.closingInputs},canEdit:!locked&&!readonly});
      };
      const comparison=(direction='up')=>({current:100,previous:90,delta:direction==='down'?-10:10,direction,percentChange:direction==='down'?-10:12});
      const report={reportDate:date,closingInputs,lock:{status:closingInputs.status,isLocked:locked,isPastDate:locked,currentBusinessDate:'2026-10-23',liveTotalsDifferFromSnapshot:q.has('snapshot-diff'),lockedAt:null,lockReason:null,lockType:null},
        totals:{expectedTotal:locked?1500:1720,totalStaffEarned:1050,totalTip:180,totalDiscount:45,totalGiftCard:50,giftCardPaymentTotal:35},
        adjustmentTotals:{actualTotalDelta:20},snapshotTotals:locked?{actualTotal:1480,expectedTotal:1500}:null,
        corrections:{adjustments:[],requests:locked?[{id:'correction-1',status:'applied',correctionType:'cash_amount',requestedValue:{value:380},moneyDelta:20,reason:'Cash recounted at end of shift',requestedByName:'Taylor Nguyen',requestedAt:'2026-10-23T02:00:00Z',approvedByName:'Owner'}]:[]},
        metadata:{ticketCount:24,finalizedTicketCount:24,excludedOpenTicketCount:2,excludedVoidedTicketCount:1},staffRows:['Anna Nguyen','Emily Tran','Sophia Le'].map((staffName,i)=>({staffId:'staff-'+i,staffName,totalEarned:350-i*20,tipAmount:60,totalTurns:8,bigTurnCount:5,smallTurnCount:3}))};
      const reportOverview={range:{preset:'this_week',label:'This week · Oct 19–23',startDate:'2026-10-19',endDate:'2026-10-23',previousStartDate:'2026-10-12',previousEndDate:'2026-10-16',businessDate:'2026-10-23',timeZone:'America/Chicago',dayCount:5},isEmpty:false,
        totals:{grossSales:12480,netSales:12100,totalRevenue:13980,ticketCount:156,averageTicket:89.62,collectedTotal:13800,dueTotal:180,tipTotal:1380,taxTotal:500,discountTotal:380},
        comparison:{grossSales:comparison(),netSales:comparison('down'),totalRevenue:comparison(),ticketCount:comparison(),bookings:comparison(),customerCount:comparison(),averageTicket:comparison()},
        trend:[1800,2200,2100,2200,2800].map((totalRevenue,i)=>({date:'2026-10-'+(19+i),label:'Oct '+(19+i),totalRevenue,ticketCount:24})),
        paymentBreakdown:[{method:'cash',amount:4200,percentOfCollected:30.4},{method:'credit_card',amount:9100,percentOfCollected:65.9},{method:'other',amount:500,percentOfCollected:3.6}],
        serviceBreakdown:[{serviceId:'gel',serviceName:'Gel manicure',category:'Nails',itemCount:40,revenue:1600,percentOfGrossSales:12.8}],
        staffAttributionSource:'pos_ticket_staff_earnings',staffRows:[{staffId:'anna',staffName:'Anna Nguyen',serviceSales:2200,tips:240,totalTurns:38,ticketCount:32,averageTicket:68.75}],
        bookingMetrics:{booked:48,completed:38,completionRate:79.2,checkedIn:2,inService:1,confirmed:5,cancelled:1,noShow:1},customerMetrics:{activeCustomers:40,returningCustomers:28,newCustomerRecords:8,linkedCustomers:32},
        recentTickets:[{id:'t1',ticketNumber:'1042',closedAt:'2026-10-23T18:30:00Z',openedAt:'2026-10-23T18:00:00Z',customerName:'Sample Customer',paymentStatus:'paid',totals:{totalRevenue:89.62}}],dataGaps:[]};
      createRoot(document.getElementById('root')).render(<WorkspaceLanguageProvider scope="preview-scope" enabled={q.has('vi')} portableEnabled={false} expiresAt={null}>
        <OwnerLiveReports viewerId="preview-viewer" salonId="preview-salon" salonName="Reylumi Sample Salon" today="2026-10-23" report={report} reportOverview={reportOverview} canEdit={!locked&&!readonly} canRequestCorrection={!q.has('no-correction')} canApplyCorrection={!q.has('request-only')}/>
      </WorkspaceLanguageProvider>);
    `},plugins:[{name:'isolated-owner-preview',setup(b){
      const replacements={
        'next/navigation':`export function usePathname(){return '/reports'};export function useSearchParams(){return new URLSearchParams(location.search)};export function useRouter(){return{push(url){window.previewNavigation=url},refresh(){window.previewRefreshed=true}}}`,
        'next/link':`import React from 'react';export default function Link({href,...p}){return <a href={href} {...p}/>}`,
        '@/components/experience-scope':`export function useExperienceScope(){return{context:{scope:'preview-scope'}}}`,
        '@/lib/use-experience-resource':`export function useExperienceResource({initialData}){return{data:initialData,available:true}}`,
        '@/lib/experience-resource-cache':`export const experienceResourceCache={get(){return null},isAvailable(){return true}}`,
        '@/lib/fetch-workspace-resource':`export function fetchWorkspaceResource(){throw Error('No report refresh in fixture')}`,
        '@/lib/pos-workspace-sync':`export function usePosResourceRefresh(){}`,
        '@/app/reports/actions':`export async function saveDailyPosClosing(payload){return window.previewSave(payload)};export async function submitDailyClosingCorrection(payload){window.previewCorrection=payload;return{ok:true}}`,
      };
      b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:replacements[a.path]}));
    }}]});
  const globalSource=fs.readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./reports";\n@source "../components/compact-filters.tsx";\n@source "../components/contextual-support.tsx";');
  const {css}=await postcss([tailwind()]).process(globalSource,{from:'app/globals.css'});
  const compiled=bundle.outputFiles.filter(x=>x.path.endsWith('.css')).map(x=>x.text).join('\n');
  const script=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text;
  return createServer((req,res)=>{
    res.setHeader('Content-Type',req.url.startsWith('/bundle.js')?'application/javascript':'text/html; charset=utf-8');
    res.end(req.url.startsWith('/bundle.js')?script:`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${compiled}\nbody{margin:0;background:white;font-family:Arial,sans-serif}.preview-brand{display:flex;align-items:center;gap:2px;padding:12px 16px 0;font-size:14px;font-weight:700}.preview-brand span:first-child{color:#008f8a}.preview-brand span:last-child{color:#f26f3d}</style></head><body><header class="preview-brand"><span>REY</span><span>LUMI</span></header><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
}
