import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {marketServiceClient} from './market-payments';
export type PaymentConfig={secretKey:string;publishableKey:string;webhookSecret:string;webhookId:string;accountId:string;portalConfigurationId?:string;enabled:boolean;mode:'test'|'live';version:number};
export type PublicPaymentConfig=Omit<PaymentConfig,'secretKey'|'webhookSecret'> & {keyConfigured:boolean;webhookConfigured:boolean};
export const PAYMENT_WEBHOOK='https://reylumi.com/api/payments/webhook';
const empty:PaymentConfig={secretKey:'',publishableKey:'',webhookSecret:'',webhookId:'',accountId:'',enabled:false,mode:'test',version:0};
function key(){const k=Buffer.from(process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY??'','base64');if(k.length!==32)throw Error('Server settings encryption is unavailable.');return k;}
export function encryptPayment(config:PaymentConfig){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);const b=Buffer.concat([c.update(JSON.stringify(config)),c.final()]);return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),b.toString('base64')].join('.');}
export async function paymentConfig():Promise<PaymentConfig>{const {data,error}=await marketServiceClient().from('platform_payment_settings').select('encrypted_config,version').eq('id',true).maybeSingle();if(error)throw Error('Payment settings could not load.');if(!data)return {...empty};const [v,iv,tag,b]=data.encrypted_config.split('.');if(v!=='v1')throw Error('Invalid payment settings.');const d=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return {...JSON.parse(Buffer.concat([d.update(Buffer.from(b,'base64')),d.final()]).toString()),version:data.version};}
export function publicPayment(config:PaymentConfig):PublicPaymentConfig{const {secretKey,webhookSecret,...rest}=config;return {...rest,keyConfigured:!!secretKey,webhookConfigured:!!webhookSecret};}
// Provider API payloads stay server-side. Return only selected fields to client components.
export async function paymentStripe(path:string,form?:URLSearchParams,idempotency?:string,config?:PaymentConfig) {
 const c=config??await paymentConfig();if(!c.secretKey)throw Error('Connect Stripe in Admin → Market & System.');
 const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:form?'POST':'GET',headers:{Authorization:`Bearer ${c.secretKey}`,'Stripe-Version':'2024-06-20',...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},body:form?.toString(),cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Payment provider request failed (${response.status}). Check the connection or retry.`);return response.json();
}
export function paymentSignature(payload:string,signature:string,secret:string,now=Date.now()) {const parts=signature.split(','),ts=parts.find(p=>p.startsWith('t='))?.slice(2);if(!secret||!ts||!/^\d+$/.test(ts)||Math.abs(now/1000-Number(ts))>300)return false;const expected=createHmac('sha256',secret).update(`${ts}.${payload}`).digest();return parts.filter(p=>p.startsWith('v1=')).some(p=>{const actual=Buffer.from(p.slice(3),'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);});}
