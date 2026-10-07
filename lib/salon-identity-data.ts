import 'server-only';
import { EMPTY_SALON_IDENTITY,type SalonIdentity } from '@/lib/salon-identity';
export async function getSalonIdentityById(rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>, ids:string[]) {
 const result=new Map<string,SalonIdentity>();
 if (!ids.length) return result;
 const {data,error}=await rpc('get_public_salon_identity',{target_salon_ids:[...new Set(ids)]});
 if (error || !Array.isArray(data)) { console.warn('Salon identity data unavailable'); return result; }
 for (const row of data) if (ids.includes(row.salon_id)) result.set(row.salon_id,{
  ...EMPTY_SALON_IDENTITY,identityVerified:row.identity_verified===true,popularServiceName:typeof row.service_name==='string'?row.service_name:null,
  popularServiceMinimumPrice:row.minimum_price==null?null:Number(row.minimum_price),popularServiceMaximumPrice:row.maximum_price==null?null:Number(row.maximum_price),completedBookingCount:Number(row.completed_booking_count??0),
 });
 return result;
}
