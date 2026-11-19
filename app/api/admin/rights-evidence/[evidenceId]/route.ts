import {serveRightsImageEvidence} from '@/lib/rights-evidence-access';

export const maxDuration=45;

export async function GET(request:Request,{params}:{params:Promise<{evidenceId:string}>}){
 return serveRightsImageEvidence(request,(await params).evidenceId);
}

// No metadata or byte work for implicit browser preflights/HEAD requests.
export async function HEAD(){return new Response(null,{status:405,headers:{Allow:'GET','Cache-Control':'private, no-store, max-age=0'}});}
