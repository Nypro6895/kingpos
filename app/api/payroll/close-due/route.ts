import { timingSafeEqual } from "node:crypto";
import { closeDuePayrollPeriods } from "@/lib/payroll-close-worker";
export const maxDuration=300;
export async function GET(request:Request){
  const expected=process.env.CRON_SECRET?Buffer.from(`Bearer ${process.env.CRON_SECRET}`):null;
  const actual=Buffer.from(request.headers.get("authorization")??"");
  if(!expected||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const result=await closeDuePayrollPeriods();
    return Response.json(result,{status:!result.configured||result.failed?503:200,headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Automatic payroll closing requires a retry."},{status:503});}
}
