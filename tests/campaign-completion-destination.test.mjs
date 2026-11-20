
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
const built=await build({entryPoints:['app/(app)/explore/campaigns/[campaignId]/page.tsx'],bundle:true,write:false,outfile:'page.mjs',format:'esm',platform:'node',jsx:'automatic',alias:{'@':process.cwd()},external:['react','react-dom'],plugins:[{name:'destination-fixture',setup(b){
 const stub={
  '@/components/experience-page':'export const withExperiencePage=x=>x;',
  'next/navigation':'export const notFound=()=>{throw Error("NOT_FOUND")};',
  'next/link':'export default function Link(p){return <a {...p}/>}',
  'next/image':'export default function Image(p){return <img alt={p.alt} src={p.src}/>}',
  '@/lib/public-booking':'export const getPublicBookingPageData=async()=>({state:globalThis.bookingState});',
  '@/lib/explore-advertising':`export const advertisingClient=()=>({from:()=>{const q={select(){return q},eq(){return q},in(field,values){globalThis.destinationStatuses=values;return q},is(){return q},gt(){return q},async maybeSingle(){return {data:globalThis.destinationCampaign}}};return q},rpc:async()=>({data:{title:"Real ad",caption:"Approved content",media_path:"fixture.webp"}}),storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:"/image.webp"}})})}});`,
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(stub,a.path)?{path:a.path,namespace:'fixture'}:null);
 b.onResolve({filter:/\.module\.css$/},a=>({path:a.path,namespace:'css'}));
 b.onLoad({filter:/.*/,namespace:'css'},()=>({contents:'export default {}',loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stub[a.path],loader:'jsx',resolveDir:process.cwd()}));
}}]});
const fs=await import('node:fs');fs.mkdirSync('artifacts/campaign-completion/destination',{recursive:true});fs.writeFileSync('artifacts/campaign-completion/destination/page.mjs',built.outputFiles[0].text);
const {default:Page}=await import('../artifacts/campaign-completion/destination/page.mjs');
test('approved custom destination survives budget completion and uses actual booking readiness',async()=>{
 globalThis.destinationCampaign={source_type:'custom',source_id:'20000000-0000-0000-0000-000000000001',salon_id:'10000000-0000-0000-0000-000000000001',approved_at:new Date().toISOString()};
 const params=Promise.resolve({campaignId:'30000000-0000-0000-0000-000000000001'});
 globalThis.bookingState='ready';
 let html=renderToStaticMarkup(await Page({params}));
 assert.match(html,/Choose a service &amp; time/);assert.match(html,/href="\/book\//);
 assert.deepEqual(globalThis.destinationStatuses,['running','completed']);
 globalThis.bookingState='booking_disabled';
 html=renderToStaticMarkup(await Page({params}));
 assert.doesNotMatch(html,/href="\/book\//);assert.match(html,/Online booking is currently unavailable/);assert.match(html,/Visit business/);
 globalThis.destinationCampaign=null;await assert.rejects(Page({params}),/NOT_FOUND/);
});
