import { NextResponse } from 'next/server';
import { getCurrentBusinessContext,isSalonManageContext } from '@/lib/current-context';
import { getDailyPosReport,canEditDailyPosClosing,canApplyFinancialCorrections } from '@/lib/daily-pos-report';
import { getOperationalReport } from '@/lib/operational-report';
import { hasPermission } from '@/lib/permissions';
export async function GET(request:Request){
 const context=await getCurrentBusinessContext();
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await hasPermission('reports.view',context))return new NextResponse(null,{status:401});
 const params=Object.fromEntries(new URL(request.url).searchParams);
 const view=params.view;
 const [report,reportOverview,canEditPermission,canApplyCorrection]=await Promise.all([
   view==='overview'?Promise.resolve(null):getDailyPosReport(params.date,context),
   view==='closing'?Promise.resolve(null):getOperationalReport(params,context),
   view==='overview'?Promise.resolve(null):canEditDailyPosClosing(context),
   view==='overview'?Promise.resolve(null):canApplyFinancialCorrections(context),
 ]);
 return NextResponse.json({salonId:context.currentSalon.id,
   ...(report?{report,canEdit:canEditPermission&&!report.lock.isLocked,canApplyCorrection}:{}),
   ...(reportOverview?{reportOverview}:{}),
 },{headers:{'Cache-Control':'no-store'}});
}
