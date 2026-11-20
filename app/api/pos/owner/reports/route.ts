import { NextResponse } from 'next/server';
import { getCurrentBusinessContext,isSalonManageContext } from '@/lib/current-context';
import { getDailyPosReport,canEditDailyPosClosing,canApplyFinancialCorrections } from '@/lib/daily-pos-report';
import { hasPermission } from '@/lib/permissions';
import { headers } from 'next/headers';
import { getExperienceContext } from '@/lib/experience-context';
import { workspaceResourceResponse } from '@/lib/workspace-resource-response';
import { createReadRequestTiming } from '@/lib/read-request-timing';
import { getDailyReportOverview } from '@/lib/daily-report-overview';
export async function GET(request:Request){
 const timing=createReadRequestTiming();
 if((await timing.measure('auth',()=>headers())).get('x-reylumi-auth-unavailable')==='1')return timing.finish(new NextResponse(null,{status:503,headers:{'Cache-Control':'private, no-store'}}));
 const context=await timing.measure('auth',()=>getCurrentBusinessContext());
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await timing.measure('auth',()=>hasPermission('reports.view',context)))return timing.finish(new NextResponse(null,{status:401}));
 const params=Object.fromEntries(new URL(request.url).searchParams);
 if(params.scope&&params.scope!==getExperienceContext(context).scope)return timing.finish(new NextResponse(null,{status:409,headers:{'Cache-Control':'private, no-store'}}));
 const view=params.view;
 const [report,canEditPermission,canApplyCorrection]=await timing.measure('load',()=>Promise.all([
   getDailyPosReport(params.date,context),
   view==='overview'?Promise.resolve(null):canEditDailyPosClosing(context),
   view==='overview'?Promise.resolve(null):canApplyFinancialCorrections(context),
 ]));
 const accountingOverview = view==='closing'?undefined:await timing.measure('load',()=>getDailyReportOverview(report,context));
 return workspaceResourceResponse(request,{salonId:context.currentSalon.id,closingScope:`${context.currentSalon.id}:${context.user.id}`,snapshotAt:Date.now(),...(accountingOverview?{accountingOverview}:{}),
   ...(report?{report,...(view==='overview'?{}:{canEdit:canEditPermission&&!report.lock.isLocked,canApplyCorrection})}:{}),
 },timing);
}
