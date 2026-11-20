import { NextResponse } from "next/server";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { isDateInputValue } from "@/lib/daily-pos-report";
import { getPayrollPageData } from "@/lib/payroll";

export async function GET(request: Request) {
 const context=await getCurrentBusinessContext();
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await hasPermission("reports.view",context)||!await hasPermission("payroll.view",context))return new NextResponse(null,{status:403,headers:{"Cache-Control":"private, no-store"}});
 const date=new URL(request.url).searchParams.get("date")??"";
 if(!isDateInputValue(date))return new NextResponse(null,{status:400});
 const result=await getPayrollPageData({preset:"custom",startDate:date,endDate:date,includeAnalytics:false,includeShopMoney:false});
 if(result.context.currentSalon?.id!==context.currentSalon.id||!result.access.canViewAllPayroll)return new NextResponse(null,{status:403});
 const row=result.live.shopDailyRows.find(r=>r.businessDate===date);
 return NextResponse.json({date,shopNetIncome:row?.shopNetIncome??null},{headers:{"Cache-Control":"private, no-store"}});
}
