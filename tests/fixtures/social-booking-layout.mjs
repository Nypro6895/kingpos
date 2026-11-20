// Offline fixtures exercise the actual imported client components and CSS.
import{build}from'esbuild';import ts from'typescript';import{readFileSync}from'node:fs';import path from'node:path';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';
const dir='artifacts/social-booking-layout-20261119';
export async function buildSocialWidgetFixture(){
const mocks={
 'next/navigation':`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({refresh(){},push(){},replace(){}});`,
 'next/link':`import React from'react';export const useLinkStatus=()=>({pending:false});export default ({prefetch,...p})=><a {...p}/>;`,
 '@/components/workspace-language':`import React from'react';export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;export const WorkspaceElement=({as:Tag='div',children,...p})=><Tag {...p}>{children}</Tag>;`,
 '@/components/salon-member-badge':`export const SalonName=({name})=>name;`,
 '@/components/salon-address-link':`export const SalonAddressLink=({children})=>children;`,
 '@/app/post-moderation/actions':`export async function loadHiddenPostIdentitiesAction(){return []};export async function postModerationAction(target,action){window.calls.push({action});if(action==='permissions')return{error:null,data:{canManage:true,caption:'A saved caption'}};throw Error('Unexpected moderation mutation');}`,
 '@/app/post-moderation/text-report-actions':`export async function reportSocialText(){throw Error('Unexpected report mutation')}`,
 '@/app/salon-profile/report-actions':`export async function reportSalonAction(){throw Error('Unexpected report mutation')}`,
 '@/app/salon-profile/actions':`export async function getSalonProfileMediaUploadSessionAction(){throw Error('Unexpected upload')}`,
 'fixture-place-actions':`export async function applyToPlaceSalon(){throw Error('Unexpected write')}export async function createPlaceSalon(){throw Error('Unexpected write')}export async function getPlaceSalon(){throw Error('Unexpected read')}export async function savePlaceSalon(){throw Error('Unexpected write')}export async function savePlaceLogo(){throw Error('Unexpected upload')}export async function searchPlaceSalons(){throw Error('Unexpected read')}`,
};
const contents=`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
 import{PostSafetyDialog}from'./components/post-safety';
 import{SocialTextReportButton}from'./components/social-text-report-button';
 import{SalonReportDialog}from'./components/salon-report-dialog';
 import{CreateSalonPanel}from'./app/my-place/place-panels';
 import{BeautyComposerDialog}from'./app/beauty/beauty-composer-dialog';
 import{ContentViewer}from'./components/content-viewer';
 import{LegalFooter}from'./components/legal-footer';import{installMobileViewport}from'./lib/mobile-viewport';
 const target={sourceType:'beauty_post',sourceId:'20000000-0000-4000-8000-000000000001'};
 window.calls=[];
 function App(){const[kind,setKind]=useState('none');window.show=kind=>flushSync(()=>setKind(kind));const close=()=>setKind('none');
 return <><main style={{minHeight:700,padding:20}}><h1>Source layout audit fixture</h1><button>Underlying page action</button>{kind==='text-report'?<SocialTextReportButton target={{kind:'comment',id:'20000000-0000-4000-8000-000000000001'}}/>:null}</main><LegalFooter/><nav className='workspace-mobile-nav'>Workspace navigation</nav>
 {kind==='post-edit'?<PostSafetyDialog target={target} mode='edit' initialCaption='A saved caption' onClose={close}/>:null}
 {kind==='salon-report'?<SalonReportDialog salon={{id:'20000000-0000-4000-8000-000000000001',name:'Fixture salon'}} onClose={close}/>:null}
 {kind==='create-salon'?<CreateSalonPanel accounts={[{id:'fixture-workspace',label:'Fixture access group'}]} onClose={close} onSaved={close}/>:null}
 {kind==='beauty-composer-control'?<BeautyComposerDialog busy={false} onClose={close}><section className='max-h-full w-full overflow-auto rounded-t-2xl bg-white p-5'><h2 id='beauty-composer-title'>New post</h2><p id='beauty-composer-description'>Composer geometry control</p><label>Caption<textarea rows={3} className='block w-full border p-3'/></label><button type='button' className='min-h-11 w-full bg-brand-orange'>Publish control</button></section></BeautyComposerDialog>:null}
 {kind==='content-viewer-control'?<ContentViewer onClose={close} aria-label='Post viewer'><section className='max-h-full w-full overflow-auto bg-white p-5'><h2>Post detail</h2><label>Comment<textarea rows={3} className='block w-full border p-3'/></label><button type='button' className='min-h-11 w-full bg-brand-orange'>Comment control</button></section></ContentViewer>:null}
 </>}
 createRoot(document.getElementById('root')).render(<App/>);installMobileViewport();
`;
const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents},bundle:true,write:false,outdir:dir+'/bundle',jsx:'automatic',plugins:[{name:'safe-fixture',setup(b){
 b.onResolve({filter:/.*/},a=>{
   if(a.path==='./actions'&&a.importer.endsWith('place-panels.tsx'))return{path:'fixture-place-actions',namespace:'fixture'};
   if(Object.hasOwn(mocks,a.path))return{path:a.path,namespace:'fixture'};
 });
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
}}]});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css+'\n'+built.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+'\n'+`
 body{margin:0;font-family:Arial,sans-serif}.workspace-mobile-nav{position:fixed;inset:auto 0 0;height:80px;background:#fff;border-top:1px solid #ccc;z-index:60;display:flex;align-items:center;justify-content:center}
`;


return{js,css:css+readFileSync('components/iphone-glass-nav.css','utf8')};
}
export async function buildSocialJourneyFixture(){
const beautyPath=path.resolve('app/beauty/beauty-profile-client.tsx').replaceAll('\\','/');
const ast=ts.createSourceFile(beautyPath,readFileSync(beautyPath,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const beautyMocks=new Map();
for(const statement of ast.statements){
 if(!ts.isImportDeclaration(statement)||!statement.importClause||statement.importClause.isTypeOnly)continue;
 const module=statement.moduleSpecifier.text;
 if(['react','react-dom','@/components/overlay-dismissal','@/components/use-overlay-viewport','@/components/beauty-profile-header','@/components/reylumi-icons','@/components/settings-icon'].includes(module))continue;
 let code="import React from'react';\n";
 if(statement.importClause.name)code+='export default function Stub({children}){return children??null;}\n';
 for(const binding of statement.importClause.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings)?statement.importClause.namedBindings.elements:[]){
  if(binding.isTypeOnly)continue;const name=binding.propertyName?.text??binding.name.text;
  if(name==='POST_CHANGED_EVENT')code+=`export const ${name}='fixture-post-change';\n`;
  else if(/ALLOWED_IMAGE_TYPES$/.test(name))code+=`export const ${name}=['image/jpeg'];\n`;
  else if(/IMAGE_LIMIT$/.test(name))code+=`export const ${name}=1000000;\n`;
  else if(name==='usePublicPhotoProcessingPermission')code+=`export function ${name}(){return{reset(){},consent:null,accepted:false,declined:false}}\n`;
  else if(name==='getAccountSavedPostStatesAction')code+=`export async function ${name}(){return{error:null,savedKeys:[],saveCountsByKey:{}}}\n`;
  else if(name==='useHiddenPosts')code+=`export function ${name}(){return[]}\n`;
  else if(name==='usePostCaption')code+=`export function ${name}(target,caption){return caption}\n`;
  else if(name==='BeautyHome')code+=`export function ${name}(){return null}\n`;
  else if(name==='WorkspaceText')code+=`export function ${name}({text}){return text}\n`;
  else if(name==='useWorkspaceTranslation')code+=`export const ${name}=()=>x=>x;\n`;
  else code+=`export function ${name}(){return null}\n`;
 }
 beautyMocks.set(module,code);
}
const mocks={
 'next/navigation':`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({refresh(){},push(){},replace(){}});`,
 'next/link':`import React from'react';export const useLinkStatus=()=>({pending:false});export default ({prefetch,...p})=><a {...p}/>;`,
 'next/image':`export default function Image({width,height,alt}){return <span role='img' aria-label={alt} style={{display:'inline-block',width,height}}/>}`,
 '@/components/workspace-language':`import React from'react';export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;export const WorkspaceElement=({as:Tag='div',children,...p})=><Tag {...p}>{children}</Tag>;`,
 '@/components/salon-member-badge':`export const SalonName=({name})=>name;`,
 '@/components/salon-address-link':`export const SalonAddressLink=({children})=>children;`,
 '@/components/block-user-button':`export const BlockUserButton=()=>null;`,
 '@/components/explore-advertising':`export const ForumCampaignSlot=()=>null;`,
 '@/components/explore-account-actions':`export const useExploreAuthenticated=()=>true;`,
 '@/components/experience-scope':`export const useExperienceScope=()=>null;`,
 '@/lib/use-scoped-ui-draft':`export const useScopedUiDraft=()=>({markEdited(){}});`,
 '@/lib/public-booking-submit-client':`export async function createPublicBookingAction(){throw Error('Unexpected booking write')}`,
 '@/lib/public-booking-availability-client':`export async function loadPublicBookingSlotsAction(){window.calls.push({action:'fixture slots'});return window.bookingFixture.slots}export async function loadPublicBookingAvailabilityHintsAction(){return[]}`,
 '@/components/booking-card-payment':`export const BookingCardPayment=()=>null;`,
 '@/components/rewardlumi/booking-reward-pending':`export const BookingRewardPending=()=>null;`,
 'forum-fixture-actions':`export async function readForum(input){window.calls.push({action:'fixture forum read',mode:input.mode});return{data:input.mode==='context'?window.forumContext:[]}}export async function writeForum(){throw Error('Unexpected forum write')}`,
};
const context={user_id:'fixture-user',display_name:'Fixture Owner',can_moderate:true,can_manage:true,restriction:null,sections:[{id:'fixture-section',name:'Owner lounge',description:'Fixture section',position:0,archived:false}]};
const topic={id:'fixture-topic',author_id:'other-user',author_name:'Fixture author',section_id:'fixture-section',title:'Fixture discussion',body:'A local discussion to open content actions.',state:null,created_at:'2026-11-19T15:00:00Z',updated_at:'2026-11-19T15:00:00Z',pinned:false,locked:false,deleted_at:null,reply_count:0,bookmarked:false};
const slot={date:'2026-11-25',startAt:'2026-11-25T15:00:00Z',endAt:'2026-11-25T15:30:00Z',label:'9:00 AM',lines:[{unitPrice:40,durationMinutes:30,staffName:'QA Professional',serviceName:'Manicure',cleanupBufferMinutes:0,displayOrder:0,lineType:'service',parentServiceId:null,serviceId:'service',staffId:'staff',startAt:'2026-11-25T15:00:00Z',endAt:'2026-11-25T15:30:00Z'}]};
const booking={state:'ready',title:'Book appointment',message:'',readiness:[],availabilityResolved:true,looks:[],staffByService:{service:['staff']},services:[{id:'service',name:'Manicure',addOnIds:[],isAddOnOnly:false,basePrice:40,durationMinutes:30,category:'Nails',description:null}],staff:[{id:'staff',displayName:'QA Professional',avatarUrl:null,bio:null,jobTitle:null,specialties:[]}],slots:[slot],salon:{salonId:'11111111-1111-4111-8111-111111111111',name:'Local QA salon',city:'Milwaukee',state:'WI',publicProfileEnabled:true,addressLine1:null,email:null,phone:null,coverUrl:null,logoUrl:null,website:null,tagline:null},settings:{anyProfessionalEnabled:false,confirmationMode:'instant_booking',defaultCleanupBufferMinutes:0,guestBookingEnabled:true,maximumAdvanceWindowDays:90,minimumLeadTimeMinutes:0,sameDayBookingEnabled:true,slotIntervalMinutes:30,splitStaffAppointmentEnabled:false,timezoneIana:'America/Chicago'},initialSelection:{serviceId:'service',serviceIds:['service'],staffId:'staff',staffMode:'specific',addOnSelections:[],addOnServiceIds:[],date:'2026-11-25',initialStep:3,startAt:slot.startAt,source:'explore',inspiration:null,lookId:null},currentUser:{id:'fixture-user',displayName:'QA Customer',firstName:'QA',lastName:'Customer',email:'qa@example.test',phone:null,avatarUrl:null}};
const contents=`import React from'react';import{createRoot}from'react-dom/client';import{BeautyProfileClient}from'./app/beauty/beauty-profile-client';import Forum from'./app/(app)/forum/forum';import{QuickBooking}from'./components/quick-booking';import{LegalFooter}from'./components/legal-footer';import{installMobileViewport}from'./lib/mobile-viewport';
window.calls=[];window.forumContext=${JSON.stringify(context)};window.bookingFixture=${JSON.stringify(booking)};
const kind=new URLSearchParams(location.search).get('kind');
function App(){return <><main style={{minHeight:700}}>{kind==='beauty-profile'?<BeautyProfileClient home={false} profile={{id:'self',isSelf:true,displayName:'Fixture Beauty',initials:'FB',visibility:'public',bio:'Saved biography',avatarUrl:null,coverImageUrl:null,coverMediaPath:null}} initialTimeline={{items:[],nextCursor:null,hasMore:false,error:null}} commentViewer={{isAuthenticated:true,userId:'self'}} visitCandidates={[]}/>:kind.startsWith('forum-')?<Forum initialContext={window.forumContext} initialTopics={[${JSON.stringify(topic)}]}/>:kind==='quickbooking'?<><button type='button' onClick={()=>window.dispatchEvent(new CustomEvent('reylumi:quick-book',{detail:{href:'/book/11111111-1111-4111-8111-111111111111'}}))}>Open quick booking</button><QuickBooking/></>:null}</main><LegalFooter/><nav className='workspace-mobile-nav'>Workspace navigation</nav></>}
createRoot(document.getElementById('root')).render(<App/>);installMobileViewport();`;
const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents},bundle:true,write:false,outdir:dir+'/journey-bundle',jsx:'automatic',plugins:[{name:'safe-offline-journeys',setup(b){
 b.onResolve({filter:/.*/},a=>{if(a.importer.replaceAll('\\','/')===beautyPath&&beautyMocks.has(a.path))return{path:a.path,namespace:'beauty-mock'};if(a.path==='./actions'&&a.importer.replaceAll('\\','/').includes('/forum/'))return{path:'forum-fixture-actions',namespace:'fixture'};if(Object.hasOwn(mocks,a.path))return{path:a.path,namespace:'fixture'}});
 b.onLoad({filter:/.*/,namespace:'beauty-mock'},a=>({contents:beautyMocks.get(a.path),loader:'tsx',resolveDir:process.cwd()}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
}}]});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css+'\n'+readFileSync('components/iphone-glass-nav.css','utf8')+'\n'+built.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+'\nbody{margin:0;font-family:Arial,sans-serif}.workspace-mobile-nav{position:fixed;inset:auto 0 0;height:80px;z-index:60;background:white}';


return{js,css,booking};
}
