import { withExperiencePage } from "@/components/experience-page";
import type {Metadata} from 'next';
import {connection} from 'next/server';
import {createSupabaseServerClient} from '@/lib/supabase/server';
export const metadata:Metadata={title:'Account deletion status',robots:{index:false,follow:false},referrer:'no-referrer'};

async function DeletionStatus({params}:{params:Promise<{token:string}>}){
 await connection();
 const {token}=await params;
 let message='This deletion receipt is unavailable. Check the complete link and try again.';
 let scheduled:string|null=null,completed:string|null=null;
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)){
  const client=createSupabaseServerClient();
  if(client){
   const {data,error}=await client.rpc('get_account_deletion_receipt',{p_token:token});
   if(error)message='Deletion status could not be checked. Please refresh to try again.';
   else if(data){
    scheduled=data.scheduledFor;completed=data.completedAt;
    message=data.status==='complete'?'Your account deletion is complete. Your sign-in identity, personal social content and personal uploads have been removed. Required business records remain under our retention policy.':data.status==='cancelled'?'This deletion request was cancelled.':data.status==='processing'?'Your account is being erased. This receipt will show completion after storage and sign-in deletion have been verified.':'Your deletion is scheduled. You can cancel from Settings while the request is pending. Deletion normally completes within 24 hours after the scheduled date.';
   }
  }
 }
 return <main data-reylumi-shell-ready="true" className="mx-auto max-w-xl px-6 py-12"><h1 className="text-2xl font-semibold">Account deletion status</h1><p role="status" className="mt-5">{message}</p>{scheduled?<p className="mt-4">Scheduled: {new Date(scheduled).toUTCString()}</p>:null}{completed?<p>Completed: {new Date(completed).toUTCString()}</p>:null}<p className="mt-5 text-sm">Keep this link private. It shows status only and cannot cancel or change your request.</p><p className="mt-4"><a href="/privacy#account-deletion" className="underline" rel="noreferrer">Deletion and retention policy</a></p></main>;
}
export default withExperiencePage(DeletionStatus);
