import { NextResponse } from 'next/server';
import { getCurrentBusinessContext,isSalonManageContext } from '@/lib/current-context';
import { getDailyPosReport,canEditDailyPosClosing,canApplyFinancialCorrections } from '@/lib/daily-pos-report';
import { getOperationalReport } from '@/lib/operational-report';
import { hasPermission } from '@/lib/permissions';
import { headers } from 'next/headers';
import { getExperienceContext } from '@/lib/experience-context';
import { workspaceResourceResponse } from '@/lib/workspace-resource-response';
export async function GET(request:Request){
 if((await headers()).get('x-reylumi-auth-unavailable')==='1')return new NextResponse(null,{status:503,headers:{'Cache-Control':'private, no-store'}});
 const context=await getCurrentBusinessContext();
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await hasPermission('reports.view',context))return new NextResponse(null,{status:401});
 const params=Object.fromEntries(new URL(request.url).searchParams);
 if(params.scope&&params.scope!==getExperienceContext(context).scope)return new NextResponse(null,{status:409,headers:{'Cache-Control':'private, no-store'}});
 const view=params.view;
 const [report,reportOverview,canEditPermission,canApplyCorrection]=await Promise.all([
   view==='overview'?Promise.resolve(null):getDailyPosReport(params.date,context),
   view==='closing'?Promise.resolve(null):getOperationalReport(params,context),
   view==='overview'?Promise.resolve(null):canEditDailyPosClosing(context),
   view==='overview'?Promise.resolve(null):canApplyFinancialCorrections(context),
 ]);
 return workspaceResourceResponse(request,{salonId:context.currentSalon.id,closingScope:`${context.currentSalon.id}:${context.user.id}`,
   ...(report?{report,canEdit:canEditPermission&&!report.lock.isLocked,canApplyCorrection}:{}),
   ...(reportOverview?{reportOverview}:{}),
 });
}
