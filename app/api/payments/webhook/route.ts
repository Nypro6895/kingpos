import {NextResponse} from 'next/server';
import {paymentConfig,paymentSignature} from '@/lib/platform-payment';
import {processCardEvent} from '@/lib/market-card';
import {readBoundedRequestText,requestBodyFailure} from '@/lib/request-body';

export async function POST(request:Request){
 let body:string;
 try{body=await readBoundedRequestText(request,1000000);}catch(error){return requestBodyFailure(error);}
 try{const config=await paymentConfig();if(!paymentSignature(body,request.headers.get('stripe-signature')??'',config.webhookSecret))return NextResponse.json({error:'Invalid signature'},{status:400});
 const event=JSON.parse(body);await processCardEvent(event.id);return NextResponse.json({received:true});
 }catch{return NextResponse.json({error:'Event processing needs retry'},{status:500});}
}
