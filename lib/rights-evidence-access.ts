import "server-only";
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import type {RightsImageEvidenceRow} from '@/types/rights-evidence';
import {isRightsEvidenceRow} from './rights-evidence-worker';
import {RIGHTS_EVIDENCE_BUCKET,isRightsEvidenceUuid,rightsEvidenceRange,rightsEvidenceServiceClient,verifiedRightsEvidenceBytes} from './rights-evidence-storage';

type AuthClient=NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
type ServiceClient=ReturnType<typeof rightsEvidenceServiceClient>;
const PRIVATE_HEADERS={
 'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Expires':'0',
 'Vary':'Cookie, Authorization, Range','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
 'X-Frame-Options':'DENY',"Content-Security-Policy":"default-src 'none'; sandbox",
};
function unavailable(status=404){return Response.json({error:'Private evidence is unavailable.'},{status,headers:PRIVATE_HEADERS});}
async function authorize(client:AuthClient,id:string):Promise<RightsImageEvidenceRow|null>{
 try{const result=await client.rpc('authorize_rights_image_evidence_read',{p_id:id});return !result.error&&isRightsEvidenceRow(result.data,'read')?result.data:null;}catch{return null;}
}
function immutablePins(row:RightsImageEvidenceRow){return JSON.stringify([row.id,row.case_id,row.source_bucket,row.source_path,row.source_object_id,row.source_version,row.source_etag,row.sha256,row.bytes,row.mime,row.evidence_bucket,row.evidence_path,row.private_object_id,row.private_version,row.private_etag,row.retain_until]);}

/** No reusable URL or client-selected object path; authorize this case on every GET. */
export async function serveRightsImageEvidence(request:Request,evidenceId:unknown,options:{authenticatedClient?:AuthClient|null;serviceClient?:ServiceClient}={}):Promise<Response>{
 if(!isRightsEvidenceUuid(evidenceId))return unavailable();
 try{
  const authenticated=options.authenticatedClient===undefined?await createAuthenticatedSupabaseServerClient():options.authenticatedClient;
  if(!authenticated)return unavailable();
  const grant=await authorize(authenticated,evidenceId);
  if(!grant||grant.id!==evidenceId)return unavailable();
  const range=rightsEvidenceRange(request.headers.get('range'),grant.bytes);
  if(!range)return new Response(null,{status:416,headers:{...PRIVATE_HEADERS,'Content-Range':`bytes */${grant.bytes}`}});
  // Instantiate a privileged reader only after an affirmative case/policy/risk
  // grant. The bounded transport buffers and hashes the entire immutable copy
  // before even a partial range can leave this server.
  const service=options.serviceClient??rightsEvidenceServiceClient();
  const result=await service.storage.from(RIGHTS_EVIDENCE_BUCKET).download(grant.evidence_path);
  if(result.error||!result.data)return unavailable(503);
  const bytes=await verifiedRightsEvidenceBytes(result.data,grant.bytes,grant.sha256);
  const current=await authorize(authenticated,evidenceId);
  if(!current||current.id!==evidenceId||immutablePins(current)!==immutablePins(grant))return unavailable();
  const responseHeaders:Record<string,string>={...PRIVATE_HEADERS,'Content-Type':'image/webp','Content-Disposition':`inline; filename="evidence-${evidenceId}.webp"`,'Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1)};
  if(request.headers.has('range'))responseHeaders['Content-Range']=`bytes ${range.start}-${range.end}/${grant.bytes}`;
  return new Response(Uint8Array.from(bytes.subarray(range.start,range.end+1)),{status:request.headers.has('range')?206:200,headers:responseHeaders});
 }catch{return unavailable(503);}
}
