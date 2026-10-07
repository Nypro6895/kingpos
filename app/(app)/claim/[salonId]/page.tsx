import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {getCurrentKingUser} from '@/lib/users/current-user';
import {getPublicSalonProfileData} from '@/lib/salon-profile';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import {businessClaimMessagingReady} from '@/lib/business-claim-provider';
import type {BusinessClaimRequest} from '@/lib/business-claims';
import {ClaimPanel} from '@/app/claim/claim-panel';

export default async function BusinessClaimPage({params}:{params:Promise<{salonId:string}>}) {
 const {salonId}=await params;
 const user=await getCurrentKingUser();
 if(!user)redirect(`/login?next=${encodeURIComponent(`/claim/${salonId}`)}`);
 const data=await getPublicSalonProfileData(salonId);
 if(!data)notFound();
 const client=await createAuthenticatedSupabaseServerClient();
 const {data:rows,error}=await client!.rpc('get_business_claim_requests',{p_salon:salonId});
 const requests=(rows??[]) as BusinessClaimRequest[];
 const request=requests.find(r=>r.applicant_user_id===user.id)??null;
 return <main className="mx-auto w-full max-w-xl px-4 py-8">
 <Link href={`/explore/salons/${salonId}`} className="text-sm text-zinc-500 underline">Back to salon</Link>
 <h1 className="mt-4 text-2xl font-semibold">{data.directoryListing?.claimState==='unclaimed'?'Claim your salon':'Request management access'}</h1>
 <div className="mt-4 rounded-2xl bg-zinc-50 p-4"><h2 className="font-semibold">{data.profile.name}</h2><p className="mt-1 text-sm text-zinc-600">{[data.profile.addressLine1,data.profile.addressLine2,data.profile.city,data.profile.state].filter(Boolean).join(', ')}</p><p className="text-sm text-zinc-600">{data.profile.phone}</p></div>
 {error?<p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">Ownership requests are temporarily unavailable. Please try again later.</p>:<ClaimPanel salonId={salonId} phone={data.profile.phone} unclaimed={data.directoryListing?.claimState==='unclaimed'} messagingReady={await businessClaimMessagingReady()} uploadsReady={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)} initialRequest={request}/>}
 </main>;
}
