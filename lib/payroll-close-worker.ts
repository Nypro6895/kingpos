import "server-only";
import { createClient } from "@supabase/supabase-js";
import { calculateFrozenPayrollPublication, type FrozenPayrollPacket } from "@/lib/payroll";

export const PAYROLL_ENGINE_VERSION = "period-ledger-1";
type Job = { inputId:string; leaseId:string; inputSha256:string; packet:FrozenPayrollPacket };

// The service client only invokes the narrowly scoped worker RPCs. User reads and
// adjustments always use their authenticated client and database authorization.
export async function closeDuePayrollPeriods() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured:false, published:0, failed:0 };
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let published=0,failed=0;
  const deadline=Date.now()+240_000;
  for(let batch=0;batch<20&&Date.now()<deadline;batch++){
    const claimed=await client.rpc("claim_payroll_close_jobs",{p_limit:10}).abortSignal(AbortSignal.timeout(30000));
    if (claimed.error) throw new Error("Automatic payroll closing is temporarily unavailable.");
    const jobs=(claimed.data??[]) as Job[];
    if(!jobs.length)break;
    for (const job of jobs) {
    if(Date.now()>=deadline)break; // Unprocessed leases remain recoverable by a later worker.
    try {
      const result=calculateFrozenPayrollPublication(job.packet);
      const saved=await client.rpc("publish_payroll_period_base",{
        p_input:job.inputId,p_lease:job.leaseId,p_input_sha256:job.inputSha256,
        p_result:result,p_engine_version:PAYROLL_ENGINE_VERSION,
      }).abortSignal(AbortSignal.timeout(30000));
      if (saved.error) throw new Error("Publication failed.");
      published++;
    } catch {
      failed++;
      // Do not log frozen payroll packets, credentials or staff financial data.
      await client.rpc("fail_payroll_close_job",{p_input:job.inputId,p_lease:job.leaseId}).abortSignal(AbortSignal.timeout(10000));
    }
    }
    if(jobs.length<10)break;
  }
  return {configured:true,published,failed};
}
