import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const out = resolve('artifacts/beauty-public-unification');
mkdirSync(out, { recursive: true });
const mock = {
  'react-dom': 'export const createPortal = content => content;',
  'next/link': 'export default function Link({href,children,prefetch,...props}) { const url = typeof href === "string" ? href : href.pathname + "?" + new URLSearchParams(href.query); return <a href={url} {...props}>{children}</a> }',
  'next/image': 'export default function Image({fill,priority,sizes,...props}) {return <img {...props} style={fill ? {position:"absolute",width:"100%",height:"100%",inset:0,objectFit:"cover"} : undefined}/>}',
  'next/navigation': 'export function notFound(){throw Error("NOT_FOUND")} export function redirect(href){throw Error("REDIRECT:"+href)}',
  '@/components/experience-page': 'export const withExperiencePage = page => page;',
  '@/lib/beauty-relationship': 'export const getBeautyProfileRoutePage = async input => {globalThis.__beautyAudit.profileInput = input; return globalThis.__beautyAudit.page}; export const getPublicBeautyProfile = async () => globalThis.__beautyAudit.profileAccess ?? {ok:true,profile:globalThis.__beautyAudit.page?.profile};',
  '@/lib/explore-personal': 'export const getPublicExploreBeautyPost = async () => globalThis.__beautyAudit.item;',
  '@/lib/post-comments': 'export const getPostCommentViewer = async () => globalThis.__beautyAudit.viewer;',
  '@/app/explore/beauty/beauty-follow-button': 'export function BeautyFollowButton({followerCount}){return <button>Follow {followerCount}</button>}',
  '@/app/saved-post/save-post-button': 'export function SavePostButton(props){return <button data-authenticated={String(props.isAuthenticated)}>Love</button>}',
  '@/components/post-share-button': 'export function PostShareButton(){return <button>Share</button>}',
  '@/components/explore-account-actions': 'export function ExploreBookButton({href,contactHref}){return <a href={href || contactHref || "#"}>Book</a>}',
  '@/app/post-comments/post-comment-thread': 'export function PostCommentThread({viewer}){return <div data-comments-authenticated={String(viewer.isAuthenticated)}>Comments</div>}',
  '@/components/workspace-language': 'export function WorkspaceText({text}){return <>{text}</>} export const useWorkspaceTranslation=()=>text=>text;',
};
const plugin = {name:'beauty-fixture',setup(b){b.onResolve({filter:/.*/},args=>mock[args.path] ? {path:args.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mock[args.path],loader:'tsx',resolveDir:process.cwd()}))}};
async function load(entry, name) {
  const outfile = resolve(out, name + '.cjs');
  await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'cjs',jsx:'automatic',packages:'external',plugins:[plugin],logLevel:'silent'});
  return require(outfile);
}
const authPrompt = await load('components/auth-intent-prompt.tsx','auth-prompt-fixture');
const profileRoute = await load('app/(app)/explore/beauty/[profileId]/page.tsx','profile-fixture');
const postRoute = await load('app/(app)/explore/beauty/[profileId]/posts/[postId]/page.tsx','post-fixture');
const profileId='11111111-1111-4111-8111-111111111111';
const postId='22222222-2222-4222-8222-222222222222';
function fixture() {
  const profile={id:profileId,displayName:'Nene',avatarUrl:'/fixture-avatar.jpg',coverImageUrl:'/fixture.jpg',bio:'Nail art and beauty moments',visibility:'public',isSelf:false,followerCount:3,isFollowing:false};
  const item={id:postId,sourceType:'personal',personal:{profileId,postType:'regular'},author:{id:profileId,name:'Nene',avatarUrl:'/fixture-avatar.jpg'},media:[{id:'media',role:'image',imageUrl:'/fixture.jpg',aspectRatio:0.8}],caption:'Would you like this set?',publishedAt:'2026-11-02T12:00:00Z',commentCount:0,saveTarget:{saved:false,saveCount:2,sourceId:postId,sourceType:'beauty_post'},destination:{href:'/explore/beauty/'+profileId+'/posts/'+postId},salon:{id:'salon',name:'King Nails Spa LLC',href:'/salon/king',city:'Milwaukee',state:'WI'},booking:{eligible:true,href:'/book/salon',bookedCount:0},bookingMeta:{price:null,durationMinutes:null,distanceMiles:null},serviceName:null,serviceCategory:null,verification:{state:'unverified'}};
  return {page:{access:'public',profile,publicPosts:[item],nextCursor:null,hasMore:false,postsError:null},item,viewer:{isAuthenticated:true,userId:'viewer'}};
}
const props={params:Promise.resolve({profileId,postId}),searchParams:Promise.resolve({})};
async function render(route) {return renderToStaticMarkup(await route.default(props))}
test('visitor profile exposes public identity and looks without personal shortcuts or misleading counts',async()=>{
 globalThis.__beautyAudit=fixture();const html=await render(profileRoute);
 assert.match(html,/data-beauty-profile-header/); assert.match(html,/Public looks/);
 assert.doesNotMatch(html,/Upcoming bookings|Saved looks|Reviews|Milwaukee|Create an account/);
 writeFileSync(resolve(out,'profile.html'),html);
});
test('self profile routes to the authenticated Beauty workspace',async()=>{
 globalThis.__beautyAudit=fixture();globalThis.__beautyAudit.page.profile.isSelf=true;
 await assert.rejects(()=>render(profileRoute),/REDIRECT:\/beauty/);
});
test('private salon relationship never renders public media',async()=>{
 globalThis.__beautyAudit=fixture();Object.assign(globalThis.__beautyAudit.page,{access:'private_relationship',customerId:'crm',publicPosts:null});
 const html=await render(profileRoute);assert.match(html,/This Beauty profile is private/);assert.doesNotMatch(html,/fixture.jpg|Public looks/);
});
test('missing profiles and mismatched post identities fail closed',async()=>{
 globalThis.__beautyAudit=fixture();globalThis.__beautyAudit.page=null;await assert.rejects(()=>render(profileRoute),/NOT_FOUND/);
 globalThis.__beautyAudit=fixture();globalThis.__beautyAudit.item.personal.profileId='other';await assert.rejects(()=>render(postRoute),/NOT_FOUND/);
});
test('public profile keeps cursor navigation and distinguishes load errors from an empty profile',async()=>{
 globalThis.__beautyAudit=fixture();Object.assign(globalThis.__beautyAudit.page,{hasMore:true,nextCursor:{createdAt:'2026-11-01',postId}});
 assert.match(await render(profileRoute),/More looks/);
 const nextProps={...props,searchParams:Promise.resolve({before:'2026-11-01',post:postId})};await profileRoute.default(nextProps);assert.deepEqual(globalThis.__beautyAudit.profileInput.cursor,{createdAt:'2026-11-01',postId});
 Object.assign(globalThis.__beautyAudit.page,{hasMore:false,publicPosts:[],postsError:'network'});const html=await render(profileRoute);assert.match(html,/Looks could not be loaded/);assert.doesNotMatch(html,/No public looks/);
});
test('signed-in and guest post use the same viewer for Love and comments without signup marketing',async()=>{
 for (const authenticated of [true,false]) {
  globalThis.__beautyAudit=fixture();globalThis.__beautyAudit.viewer.isAuthenticated=authenticated;
  const html=await render(postRoute);assert.match(html,new RegExp('data-authenticated="'+authenticated+'"'));assert.match(html,new RegExp('data-comments-authenticated="'+authenticated+'"'));
  assert.doesNotMatch(html,/Create an account|2:30 PM|3:30 PM|4:30 PM|Price varies|Time varies|More options/);
  assert.equal((html.match(/Would you like this set\?/g)||[]).length,1);
  if(authenticated)writeFileSync(resolve(out,'post.html'),html);
 }
});
test('unlinked posts do not advertise salon booking or fabricated prices',async()=>{
 globalThis.__beautyAudit=fixture();Object.assign(globalThis.__beautyAudit.item,{salon:null,booking:null});const html=await render(postRoute);assert.doesNotMatch(html,/View salon|Choose Book to check|Price varies/);
});
test('profile identity and caption render untrusted text safely',async()=>{
 globalThis.__beautyAudit=fixture();globalThis.__beautyAudit.page.profile.displayName='<script>alert(1)</script>';assert.doesNotMatch(await render(profileRoute),/<script>/);
});
test('source routes share identity, retain server visibility resolver, and forward cursor',()=>{
 const read=p=>readFileSync(p,'utf8');
 for(const p of ['app/explore/beauty/beauty-profile-read-view.tsx','app/beauty/beauty-profile-client.tsx'])assert.match(read(p),/<BeautyProfileHeader/);
 assert.match(read('lib/beauty-relationship.ts'),/cursor: input.cursor/);
 const feed=read('app/explore/explore-feed.tsx');const card=feed.slice(feed.indexOf('function ExploreFeedCard('),feed.indexOf('function ExploreFeedCard(')+4000);assert.match(card,/<PostIdentity/);assert.doesNotMatch(card,/[ÂÃ]/);
});

test('blocked or private profiles cannot be bypassed through a direct post URL or metadata',async()=>{globalThis.__beautyAudit=fixture();globalThis.__beautyAudit.profileAccess={ok:false,profile:null};await assert.rejects(()=>render(postRoute),/NOT_FOUND/);assert.equal((await postRoute.generateMetadata(props)).title,'Beauty post not found | Reylumi');});

test('known account session recovery offers login and never signup; guests retain signup',()=>{globalThis.window={location:{pathname:'/explore',search:'',hash:''}};globalThis.document={body:{}};for(const returningUser of [true,false]){const html=renderToStaticMarkup(React.createElement(authPrompt.AuthIntentPrompt,{returningUser,kicker:'Save intent',title:'Save this look?',onClose:()=>{}},'Create a free account'));if(returningUser){assert.match(html,/Sign in again/);assert.match(html,/href="\/login\?next=/);assert.doesNotMatch(html,/href="\/signup|Create a free account|Create account/);}else{assert.match(html,/href="\/signup/);}}});

test('profile metadata reads identity without loading the post page or private relationship content',async()=>{globalThis.__beautyAudit=fixture();const metadata=await profileRoute.generateMetadata(props);assert.equal(metadata.title,'Nene | Reylumi Beauty');assert.equal(globalThis.__beautyAudit.profileInput,undefined);globalThis.__beautyAudit.profileAccess={ok:false,profile:null};assert.equal((await profileRoute.generateMetadata(props)).title,'Beauty profile | Reylumi');});
