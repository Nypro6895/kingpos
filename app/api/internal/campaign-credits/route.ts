import { processCampaignCreditQueue } from "@/lib/campaign-payments";
import { timingSafeEqual } from "node:crypto";
export const maxDuration=300;
export async function GET(request:Request){
  const secret=process.env.CAMPAIGN_QUEUE_SECRET || process.env.CRON_SECRET;
  const token=request.headers.get("authorization")??"";
  const expected=Buffer.from(`Bearer ${secret??""}`);const actual=Buffer.from(token);
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response("Unauthorized",{status:401});
  try {
    const result=await processCampaignCreditQueue();
    return Response.json(result,{status:result.ok?200:503});
  }catch {
    // Do not leak database/provider credentials or raw errors in a cron response.
    return Response.json({ok:false,error:"Campaign credit queue unavailable."},{status:503});
  }
}
