import { fulfillCreditPayment,verifyCampaignWebhook,expireCreditCheckout,fulfillCampaignCardSetup } from "@/lib/campaign-payments";
import { readBoundedRequestText,requestBodyFailure } from "@/lib/request-body";
export async function POST(request:Request){
  let raw:string;
  try{raw=await readBoundedRequestText(request,262144);}catch(error){return requestBodyFailure(error);}
  if(!verifyCampaignWebhook(raw,request.headers.get("stripe-signature")??""))return new Response("Invalid signature",{status:400});
  try{
    const event=JSON.parse(raw);
    if(event.type==="checkout.session.completed"&&event.data.object.metadata?.campaign_card_setup)await fulfillCampaignCardSetup(event.data.object.id);
    if(event.type==="payment_intent.succeeded"&&event.data.object.metadata?.campaign_credit_order)await fulfillCreditPayment(event.data.object.id);
    if(event.type==="checkout.session.expired"&&event.data.object.metadata?.campaign_credit_order)await expireCreditCheckout(event.data.object.metadata.campaign_credit_order);
    return Response.json({received:true});
  }catch{return new Response("Payment recording will be retried",{status:500});}
}
