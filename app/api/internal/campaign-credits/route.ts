import { processCampaignCreditQueue } from "@/lib/campaign-payments";
import { timingSafeEqual } from "node:crypto";
export const maxDuration=300;
export async function GET(request:Request){
  const secret=process.env.CAMPAIGN_QUEUE_SECRET || process.env.CRON_SECRET;
  const token=request.headers.get("authorization")??"";
  const expected=Buffer.from(`Bearer ${secret??""}`);const actual=Buffer.from(token);
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response("Unauthorized",{status:401});
  await processCampaignCreditQueue();return Response.json({ok:true});
}
