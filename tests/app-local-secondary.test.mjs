import test from'node:test';import assert from'node:assert/strict';import{build}from'esbuild';
test('visit and transformation reads use the original authorized loaders; deleted visits cannot return a retained DTO',async()=>{
 const s=globalThis.secondaryFixture={context:{user:{id:'viewer-a'},scope:'scope-a'},calls:[],visit:{salonName:'Salon A',status:'arrived',checkedInAt:'2026-10-16T12:00:00Z',timezone:'UTC',bookingId:null,isCustomer:true,salonPhone:'+123',serverOnly:'never-in-DTO'},denied:false};
 const modules={'server-only':'','request-business-context':'export async function getRequestBusinessContext(){return globalThis.secondaryFixture.context}',
 'experience-context':'export const getExperienceContext=context=>({scope:context.scope})',
 'route-context-guards':'export async function requireSalonManagePageContext(){if(globalThis.secondaryFixture.denied)throw Object.assign(Error("Denied"),{status:403});return globalThis.secondaryFixture.context}',
 'supabase/server':'export async function createAuthenticatedSupabaseServerClient(){return{rpc:async(name,args)=>{const s=globalThis.secondaryFixture;s.calls.push({name,args});return{data:s.visit,error:null}}}}',
 'beauty-salon-publications':'export async function listBeautySalonPublicationRequests(){globalThis.secondaryFixture.calls.push("transformation-review");return{requests:[],salonName:"Salon A"}}',
 'explore-reference-favorites':'export async function resolveReferenceFavorites(){return{items:[{href:"/explore/salons/11111111-1111-4111-8111-111111111111"}]}}'};
 const output=await build({entryPoints:['lib/app-local-secondary-server.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'authorized-reads',setup(b){b.onResolve({filter:/.*/},a=>{const key=Object.keys(modules).find(k=>a.path===k||a.path.endsWith('/'+k));return key?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:modules[a.path]}));}}]});const{readAppLocalSecondaryResource:read}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
 const args={visitId:'22222222-2222-4222-8222-222222222222'};
 await assert.rejects(read('customer.visit',args,{scope:'other'}),{status:409});assert.equal(s.calls.length,0);
 const first=await read('customer.visit',args,{scope:'scope-a'});assert.equal(first.data.salonName,'Salon A');assert.equal('serverOnly'in first.data,false);assert.deepEqual(s.calls[0],{name:'get_notification_visit',args:{p_id:args.visitId}});
 const next=await read('customer.visit',args,{scope:'scope-a',etag:first.etag});assert.equal(next.status,304);assert.equal('data'in next,false);
 s.visit=null;await assert.rejects(read('customer.visit',args,{scope:'scope-a'}),{status:404});
 s.denied=true;await assert.rejects(read('owner.transformations',{}, {scope:'scope-a'}),{status:403});assert.equal(s.calls.includes('transformation-review'),false);
});
