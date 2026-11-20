import "server-only";
import {timingSafeEqual} from 'node:crypto';
import type {RightsEvidenceCounts,RightsEvidenceStage} from './rights-evidence-worker';

type Removed={removed:number;failed:number};
type PostMedia={claimed:number;removed:number;failed:number;deferred:number};
type Dependencies={
 authorization:()=>string|null;backgroundDisabled:()=>boolean;
 erase:()=>Promise<{completed:number;failed:number}>;
 exports:()=>Promise<Removed>;staging:()=>Promise<Removed>;postMedia:()=>Promise<PostMedia>;
 rights:(stage:RightsEvidenceStage)=>Promise<RightsEvidenceCounts>;
};
const privateHeaders={'Cache-Control':'no-store'};
async function isolated<T>(run:()=>Promise<T>,fallback:T):Promise<T>{try{return await run();}catch{return fallback;}}
const rightsFailure=():RightsEvidenceCounts=>({claimed:0,captured:0,removed:0,purged:0,failed:1,deferred:0,blocked:0});

/** Preserve older cleanup→erasure ordering. New work never adds to its deadline. */
export function createAccountMaintenanceHandler(deps:Dependencies){
 return async(request:Request)=>{
  const configured=deps.authorization(),expected=configured?Buffer.from(configured):null,actual=Buffer.from(request.headers.get('authorization')??'');
  if(!expected||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({error:'Unauthorized'},{status:401,headers:privateHeaders});
  if(deps.backgroundDisabled())return Response.json({error:'Background maintenance is disabled.'},{status:503,headers:privateHeaders});
  const legacy=async()=>{
   const [exports,imageStaging,postMedia]=await Promise.all([
    isolated(deps.exports,{removed:0,failed:1}),isolated(deps.staging,{removed:0,failed:1}),
    isolated(deps.postMedia,{claimed:0,removed:0,failed:1,deferred:0}),
   ]);
   const result=await isolated(deps.erase,{completed:0,failed:1});
   return{...result,exports,imageStaging,postMedia};
  };
  const rights=async()=>{
   // Separate passes and explicit removal intent. At most one job per stage.
   // Each pass is bounded to 45s new work + one <=12s request. All three remain
   // below the older 230s erasure budget, rather than preceding it serially.
   const capture=await isolated(()=>deps.rights('capture'),rightsFailure());
   const removeOrigin=await isolated(()=>deps.rights('remove_origin'),rightsFailure());
   const purge=await isolated(()=>deps.rights('purge'),rightsFailure());
   return{capture,removeOrigin,purge};
  };
  const [result,rightsEvidence]=await Promise.all([legacy(),rights()]);
  const failed=result.failed||result.exports.failed||result.imageStaging.failed||result.postMedia.failed||Object.values(rightsEvidence).some(row=>row.failed>0);
  return Response.json({...result,rightsEvidence},{status:failed?503:200,headers:privateHeaders});
 };
}
