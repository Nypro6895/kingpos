import "server-only";
import {loadFinancialInputHistory} from "./financial-input-history";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
export async function loadPayrollLiveHistory(client:NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>,salonId:string,start:string,end:string,staffId?:string){
 return loadFinancialInputHistory(client,salonId,start,end,{staffId,surface:"payroll"});
}
