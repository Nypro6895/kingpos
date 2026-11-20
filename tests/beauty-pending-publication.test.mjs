import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import ts from 'typescript';

const executablePath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const options={skip:!executablePath,timeout:30000};
let browser,server,url;
const empty={items:[],nextCursor:null,hasMore:false,error:null};
const published=()=>({error:null,publicationStatus:'published',timeline:{...empty,items:[{id:'confirmed',profileId:'profile-a',caption:'Confirmed post',createdAt:'2026-11-16T20:00:00Z',updatedAt:'2026-11-16T20:00:00Z',editedAt:null,type:'regular',visibility:'public',media:[],author:{profileId:'profile-a',displayName:'Author',avatarUrl:null},attribution:null,verification:null,reward:null,salonPublication:null,bookingAction:null,commentCount:0}]}});

before(async()=>{
 if(!executablePath)return;
 const componentPath=process.cwd().replaceAll('\\','/')+'/app/beauty/beauty-profile-client.tsx';
 const source=readFileSync(componentPath,'utf8'),ast=ts.createSourceFile(componentPath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='BeautyProfileClient');
 const returned=component.body.statements.findLast(n=>ts.isReturnStatement(n));
 const expose=`window.qa={addNormalFiles,publishPost,openComposer,setCaption,editPendingDraft,retry(){const a=publishAttemptRef.current;if(a)submitPublishAttempt(a);},state:{caption,pendingPost,normalMedia:normalMedia.map(m=>({id:m.id,path:m.objectPath,previewUrl:m.previewUrl})),posts:posts.map(p=>p.id),composerOpen}};`;
 const instrumented=source.slice(0,returned.getStart(ast))+expose+source.slice(returned.getStart(ast));
 const mocks=new Map();
 for(const statement of ast.statements){
  if(!ts.isImportDeclaration(statement)||!statement.importClause||statement.importClause.isTypeOnly)continue;
  const path=statement.moduleSpecifier.text;
  if(['react','react-dom','./beauty-composer-dialog','@/lib/public-image-upload-client','@/lib/media-upload-progress','@/lib/public-post-receipt','@/components/public-photo-processing-permission','@/lib/public-photo-processing-consent'].includes(path))continue;
  let code="import React from 'react';\n";
  if(statement.importClause.name)code+='export default function Stub(p){return <a href={p.href}>{p.children}</a>;}\n';
  const bindings=statement.importClause.namedBindings;
  for(const binding of bindings&&ts.isNamedImports(bindings)?bindings.elements:[]){
   if(binding.isTypeOnly)continue;const name=binding.propertyName?.text??binding.name.text;
   if(name==='POST_CHANGED_EVENT')code+=`export const ${name}='fixture-change';\n`;
   else if(/ALLOWED_IMAGE_TYPES$/.test(name))code+=`export const ${name}=['image/png','image/jpeg','image/webp'];\n`;
   else if(/IMAGE_LIMIT$/.test(name))code+=`export const ${name}=1000000;\n`;
   else if(name==='compressImageCanvas')code+=`export async function ${name}(){return{blob:new Blob(['fixture'],{type:'image/webp'}),width:1,height:1};}\n`;
   else if(name==='encodeStoragePath')code+=`export const ${name}=value=>value.split('/').map(encodeURIComponent).join('/');\n`;
   else if(name==='getBeautyMediaUploadSessionAction')code+=`export async function ${name}(role){const i=window.h.sessions.length;const value={bucket:'quarantine-fixture',path:'private/'+i,objectPath:'actor/beauty/'+role+'/'+i+'.webp',supabaseUrl:'https://fixture.invalid',accessToken:'fixture',anonKey:'fixture'};window.h.sessions.push(value);return value;}\n`;
   else if(name==='deleteBeautyMediaAction')code+=`export async function ${name}(path){window.h.deleted.push(path);}\n`;
   else if(name==='createBeautyPostAction')code+=`export function ${name}(input){return new Promise((resolve,reject)=>window.h.publishes.push({input,resolve,reject}));}\n`;
   else if(name==='getAccountSavedPostStatesAction')code+=`export async function ${name}(){return{error:null,savedKeys:[],saveCountsByKey:{}};}\n`;
   else if(name==='useHiddenPosts')code+=`export function ${name}(){return[];}\n`;
   else if(name==='usePostCaption')code+=`export function ${name}(target,caption){return caption;}\n`;
   else code+=`export function ${name}(){return null;}\n`;
  }
  mocks.set(path,code);
 }
 const output=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{BeautyProfileClient}from'./app/beauty/beauty-profile-client';
window.h={uploads:[],sessions:[],publishes:[],deleted:[]};
class HeldXHR{upload={};status=0;responseText='';open(method,url){this.url=url;}setRequestHeader(){}send(blob){this.blob=blob;window.h.uploads.push(this);}abort(){this.onabort?.();}succeed(){this.status=201;this.upload.onprogress?.({lengthComputable:true,loaded:1,total:1});this.onload?.();}}
window.XMLHttpRequest=HeldXHR;
function App(){const[actor,setActor]=React.useState('a');window.h.changeScope=()=>setActor('b');return <BeautyProfileClient home={false} profile={{id:'profile-'+actor,isSelf:true,displayName:'Author',initials:'A',visibility:'public',bio:null,avatarUrl:null,coverImageUrl:null,coverMediaPath:null,createdAt:''}} initialTimeline={{items:[],nextCursor:null,hasMore:false,error:null}} commentViewer={{isAuthenticated:true,userId:'user-'+actor}} visitCandidates={[]}/>;}
createRoot(document.getElementById('root')).render(<App/>);`},plugins:[{name:'actual-beauty-pending-ui',setup(b){
  b.onResolve({filter:/.*/},args=>mocks.has(args.path)?{path:args.path,namespace:'mock'}:args.path==='@/lib/public-image-upload-client'?{path:process.cwd()+'/lib/public-image-upload-client.ts'}:args.path==='@/lib/media-upload-progress'?{path:process.cwd()+'/lib/media-upload-progress.ts'}:args.path==='@/lib/public-post-receipt'?{path:process.cwd()+'/lib/public-post-receipt.ts'}:args.path==='@/components/public-photo-processing-permission'?{path:process.cwd()+'/components/public-photo-processing-permission.tsx'}:args.path==='@/lib/public-photo-processing-consent'?{path:process.cwd()+'/lib/public-photo-processing-consent.ts'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks.get(args.path),loader:'tsx',resolveDir:process.cwd()}));
  b.onLoad({filter:/beauty-profile-client\.tsx$/},args=>args.path.replaceAll('\\','/')===componentPath?{contents:instrumented,loader:'tsx',resolveDir:process.cwd()+'/app/beauty'}:undefined);
 }}]});
 const js=output.outputFiles.find(f=>f.path.endsWith('.js')).text;
 let css=output.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
 if(process.env.CAPTURE_BEAUTY_VISUALS==='1'){
  const {default:postcss}=await import('postcss'),{default:tailwind}=await import('@tailwindcss/postcss');
  css=(await postcss([tailwind({base:process.cwd()})]).process(readFileSync('app/globals.css','utf8'),{from:process.cwd()+'/app/globals.css'})).css+'\n'+css;
 }
 server=createServer((_,response)=>{response.setHeader('Content-Type','text/html');response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script>'+js+'</script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath,headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function fixture(t){const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});await page.goto(url);await page.waitForFunction(()=>window.qa);return page;}

test('unknown server success freezes one request and retry never creates a new payload',options,async t=>{
 const p=await fixture(t);await p.evaluate(()=>{qa.setCaption('Keep my draft');});await p.waitForFunction(()=>qa.state.caption==='Keep my draft');
 await p.evaluate(()=>{qa.publishPost();qa.publishPost();});await p.waitForFunction(()=>h.publishes.length===1);
 assert.equal(await p.getByLabel('Your pending Beauty post').count(),1);assert.deepEqual(await p.evaluate(()=>qa.state.posts),[]);
 const original=await p.evaluate(()=>h.publishes[0].input);assert.match(original.requestId,/^[a-f0-9-]{36}$/);
 await p.evaluate(()=>h.publishes[0].reject(Error('lost response')));await p.waitForFunction(()=>qa.state.pendingPost?.phase==='unknown');
 await p.evaluate(()=>{qa.publishPost();qa.retry();qa.retry();});await p.waitForFunction(()=>h.publishes.length===2);
 assert.deepEqual(await p.evaluate(()=>h.publishes[1].input),original);assert.deepEqual(await p.evaluate(()=>h.deleted),[]);
 await p.evaluate(result=>h.publishes[1].resolve(result),published());await p.waitForFunction(()=>qa.state.posts[0]==='confirmed');
 assert.equal(await p.getByLabel('Your pending Beauty post').count(),0);assert.equal(await p.evaluate(()=>qa.state.caption),'');
});

test('selected local previews appear before upload; Post waits for ordered bounded uploads and server confirmation',options,async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{qa.openComposer('regular');const raw=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));void qa.addNormalFiles(['a','b','c','d'].map(name=>new File([raw],name+'.png',{type:'image/png'})));});
 await p.waitForFunction(()=>qa.state.normalMedia.length===4);
 assert.equal(await p.locator('img[alt="Selected Beauty post preview"]').count(),4);
 assert.equal(await p.evaluate(()=>qa.state.normalMedia.every(m=>m.previewUrl.startsWith('blob:')&&!m.path)),true);
 await p.waitForFunction(()=>h.uploads.length===2);
 const permission=p.getByRole('checkbox',{name:'I agree to send the photos in this post to OpenAI for this safety check.'});
 assert.equal(await permission.isChecked(),false);assert.equal(await p.getByRole('button',{name:'Post',exact:true}).isDisabled(),true);
 await p.evaluate(()=>qa.publishPost());assert.equal(await p.evaluate(()=>h.publishes.length),0);
 assert.equal(await p.evaluate(()=>qa.state.normalMedia.length),4);
 await permission.check();await p.getByRole('button',{name:'Post',exact:true}).click();
 await p.waitForFunction(()=>qa.state.pendingPost?.phase==='uploading');assert.equal(await p.evaluate(()=>h.publishes.length),0);
 await p.evaluate(()=>h.uploads[1].succeed());await p.waitForFunction(()=>h.uploads.length===3);
 await p.evaluate(()=>h.uploads[0].succeed());await p.waitForFunction(()=>h.uploads.length===4);
 await p.evaluate(()=>{h.uploads[3].succeed();h.uploads[2].succeed();});await p.waitForFunction(()=>h.publishes.length===1);
 const input=await p.evaluate(()=>h.publishes[0].input);
 assert.deepEqual(input.photoProcessingConsent,{provider:'openai',noticeVersion:'public-photo-openai-20261118-v1',accepted:true});
 assert.deepEqual(input.media.map(m=>m.objectPath),[0,1,2,3].map(i=>'actor/beauty/image/'+i+'.webp'));
 assert.equal(await p.evaluate(()=>h.uploads.every(x=>x.url.includes('/private/'))),true);
 assert.deepEqual(await p.evaluate(()=>qa.state.posts),[]);assert.equal(await p.getByLabel('Your pending Beauty post').count(),1);
 await p.evaluate(()=>h.publishes[0].resolve({error:'Service temporarily unavailable',outcome:'rejected'}));await p.waitForFunction(()=>qa.state.pendingPost?.phase==='failed');
 await p.getByRole('button',{name:'Review draft',exact:true}).click();await p.waitForFunction(()=>qa.state.composerOpen);
 assert.equal(await permission.isChecked(),false);assert.equal(await p.getByRole('button',{name:'Post',exact:true}).isDisabled(),true);
 assert.equal(await p.locator('img[alt="Selected Beauty post preview"]').count(),4);assert.deepEqual(await p.evaluate(()=>h.deleted),[]);
});

test('a late publication response cannot populate another account scope',options,async t=>{
 const p=await fixture(t);await p.evaluate(()=>qa.setCaption('Private author draft'));await p.waitForFunction(()=>qa.state.caption.length>0);
 await p.evaluate(()=>qa.publishPost());await p.waitForFunction(()=>h.publishes.length===1);
 await p.evaluate(()=>h.changeScope());await p.waitForFunction(()=>!qa.state.pendingPost&&qa.state.caption==='');
 await p.evaluate(result=>h.publishes[0].resolve(result),published());
 await p.waitForFunction(()=>!qa.state.pendingPost);assert.deepEqual(await p.evaluate(()=>qa.state.posts),[]);
 assert.equal(await p.getByLabel('Your pending Beauty post').count(),0);
});

test('photo permission stays bound to the exact unknown request across reload and resets after completion',options,async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{qa.openComposer('regular');qa.setCaption('This photo only');const raw=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));void qa.addNormalFiles([new File([raw],'photo.png',{type:'image/png'})]);});
 await p.waitForFunction(()=>h.uploads.length===1);
 const permission=p.getByRole('checkbox',{name:'I agree to send the photos in this post to OpenAI for this safety check.'});
 await permission.check();await p.getByRole('button',{name:'Post',exact:true}).click();await p.evaluate(()=>h.uploads[0].succeed());
 await p.waitForFunction(()=>h.publishes.length===1);const original=await p.evaluate(()=>h.publishes[0].input);
 assert.deepEqual(original.photoProcessingConsent,{provider:'openai',noticeVersion:'public-photo-openai-20261118-v1',accepted:true});
 await p.evaluate(()=>h.publishes[0].reject(Error('lost photo response')));await p.waitForFunction(()=>qa.state.pendingPost?.phase==='unknown');
 await p.reload();await p.waitForFunction(()=>window.qa?.state.pendingPost?.phase==='unknown');assert.equal(await permission.count(),0);
 await p.getByRole('button',{name:'Retry this same post',exact:true}).click();await p.waitForFunction(()=>h.publishes.length===1);
 assert.deepEqual(await p.evaluate(()=>h.publishes[0].input),original);assert.equal(await p.evaluate(()=>h.uploads.length),0);
 await p.evaluate(result=>h.publishes[0].resolve(result),published());await p.waitForFunction(()=>!qa.state.pendingPost);
 await p.evaluate(()=>{qa.openComposer('regular');const raw=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));void qa.addNormalFiles([new File([raw],'new-photo.png',{type:'image/png'})]);});
 await permission.waitFor();assert.equal(await permission.isChecked(),false);assert.equal(await p.getByRole('button',{name:'Post',exact:true}).isDisabled(),true);
});

test('legacy unknown photo receipt is replayed unchanged; new processing after rejection requires a fresh choice and UUID',options,async t=>{
 const p=await fixture(t),legacy={requestId:'10000000-0000-4000-8000-000000000001',caption:'Legacy photo',postType:'regular',media:[{objectPath:'actor/beauty/image/legacy.webp',role:'image'}]};
 await p.evaluate(input=>sessionStorage.setItem('reylumi:public-post:v1:beauty:user-a:profile-a',JSON.stringify({version:1,status:'unconfirmed',requestId:input.requestId,input})),legacy);
 await p.reload();await p.waitForFunction(()=>window.qa?.state.pendingPost?.phase==='unknown');
 await p.getByRole('button',{name:'Retry this same post',exact:true}).click();await p.waitForFunction(()=>h.publishes.length===1);
 assert.deepEqual(await p.evaluate(()=>h.publishes[0].input),legacy);
 await p.evaluate(()=>h.publishes[0].resolve({error:'Photo permission is required for new processing.',outcome:'rejected'}));await p.waitForFunction(()=>qa.state.pendingPost?.phase==='failed');
 await p.getByRole('button',{name:'Review draft',exact:true}).click();
 const permission=p.getByRole('checkbox',{name:'I agree to send the photos in this post to OpenAI for this safety check.'});
 assert.equal(await permission.isChecked(),false);assert.equal(await p.getByRole('button',{name:'Post',exact:true}).isDisabled(),true);
 await permission.check();await p.getByRole('button',{name:'Post',exact:true}).click();await p.waitForFunction(()=>h.publishes.length===2);
 const fresh=await p.evaluate(()=>h.publishes[1].input);assert.notEqual(fresh.requestId,legacy.requestId);
 assert.deepEqual(fresh.photoProcessingConsent,{provider:'openai',noticeVersion:'public-photo-openai-20261118-v1',accepted:true});
 assert.equal(await p.evaluate(()=>h.uploads.length),0);
});

test('reload restores an unresolved create receipt without resubmitting or changing its UUID',options,async t=>{
 const p=await fixture(t);await p.evaluate(()=>qa.setCaption('Recover this exact post'));await p.waitForFunction(()=>qa.state.caption.length>0);
 await p.evaluate(()=>qa.publishPost());await p.waitForFunction(()=>h.publishes.length===1);
 const original=await p.evaluate(()=>h.publishes[0].input);
 assert.equal(Object.hasOwn(original,'photoProcessingConsent'),false,'text-only recovery must not manufacture photo permission');
 assert.equal(await p.evaluate(()=>sessionStorage.length),1);
 await p.reload();await p.waitForFunction(()=>window.qa?.state.pendingPost?.phase==='unknown');
 assert.equal(await p.evaluate(()=>h.publishes.length),0);assert.equal(await p.evaluate(()=>qa.state.caption),'Recover this exact post');
 await p.getByRole('button',{name:'Retry this same post',exact:true}).click();await p.waitForFunction(()=>h.publishes.length===1);
 assert.deepEqual(await p.evaluate(()=>h.publishes[0].input),original);
 await p.evaluate(result=>h.publishes[0].resolve(result),published());await p.waitForFunction(()=>!qa.state.pendingPost);
 assert.equal(await p.evaluate(()=>sessionStorage.length),0);
});

test('unavailable receipt persistence prevents the create action and keeps a retryable draft',options,async t=>{
 const p=await fixture(t);await p.evaluate(()=>{qa.setCaption('Do not lose this draft');h.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('quota');};});
 await p.waitForFunction(()=>qa.state.caption.length>0);await p.evaluate(()=>qa.publishPost());await p.waitForFunction(()=>qa.state.pendingPost?.phase==='failed');
 assert.equal(await p.evaluate(()=>h.publishes.length),0);assert.equal(await p.evaluate(()=>qa.state.caption),'Do not lose this draft');
 const request=await p.evaluate(()=>qa.state.pendingPost.requestId);
 await p.evaluate(()=>{Storage.prototype.setItem=h.originalSet;qa.retry();});await p.waitForFunction(()=>h.publishes.length===1);
 assert.equal(await p.evaluate(()=>h.publishes[0].input.requestId),request);
});

test('a batch failure cleans failed allocation and every later successful upload',options,async t=>{
 const p=await fixture(t);
 await p.evaluate(()=>{const raw=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));void qa.addNormalFiles([0,1,2].map(n=>new File([raw],n+'.png',{type:'image/png'})));});
 await p.waitForFunction(()=>h.uploads.length===2);await p.evaluate(()=>h.uploads[0].succeed());await p.waitForFunction(()=>h.uploads.length===3);
 await p.evaluate(()=>h.uploads[1].onerror());await p.waitForFunction(()=>h.deleted.includes('actor/beauty/image/1.webp'));
 await p.evaluate(()=>h.uploads[2].succeed());await p.waitForFunction(()=>h.deleted.length===3);
 assert.deepEqual((await p.evaluate(()=>h.deleted)).sort(),[0,1,2].map(n=>'actor/beauty/image/'+n+'.webp'));
 assert.equal(await p.evaluate(()=>qa.state.normalMedia.length),3);assert.equal(await p.evaluate(()=>h.publishes.length),0);
});

test('local pending-card phone/tablet visuals and 44px recovery controls', {...options,skip:!executablePath||process.env.CAPTURE_BEAUTY_VISUALS!=='1'}, async t=>{
 const p=await fixture(t),directory='artifacts/public-photo-processing-consent-ui-20261118/beauty-visuals';mkdirSync(directory,{recursive:true});
 await p.setViewportSize({width:390,height:844});
 await p.evaluate(()=>{qa.openComposer('regular');qa.setCaption('A new beauty moment');const c=document.createElement('canvas');c.width=600;c.height=420;const x=c.getContext('2d');x.fillStyle='#f5e1d7';x.fillRect(0,0,600,420);x.fillStyle='#d593a9';for(let i=0;i<4;i++){x.beginPath();x.roundRect(95+i*105,80,65,245,30);x.fill();}c.toBlob(blob=>{void qa.addNormalFiles([new File([blob],'local-qa-photo.png',{type:'image/png'})]);},'image/png');});
 await p.waitForFunction(()=>h.uploads.length===1);await p.screenshot({path:directory+'/beauty-composer-preview-phone.png'});
 const permission=p.getByRole('checkbox',{name:'I agree to send the photos in this post to OpenAI for this safety check.'});
 await p.getByRole('region',{name:'Photo safety check'}).scrollIntoViewIfNeeded();assert.equal(await permission.isChecked(),false);assert.equal(await p.getByRole('button',{name:'Post',exact:true}).isDisabled(),true);
 await p.screenshot({path:directory+'/beauty-consent-unchecked-phone.png'});
 await p.getByRole('checkbox',{name:'I agree to send the photos in this post to OpenAI for this safety check.'}).check();
 await p.evaluate(()=>qa.publishPost());await p.waitForFunction(()=>qa.state.pendingPost?.phase==='uploading');
 await p.waitForFunction(()=>{const r=document.querySelector('[aria-label="Your pending Beauty post"]')?.getBoundingClientRect();return r&&r.top>=0&&r.top<64;});
 const phoneCard=await p.getByLabel('Your pending Beauty post').boundingBox();
 await p.screenshot({path:directory+'/beauty-pending-phone.png'});
 await p.evaluate(()=>h.uploads[0].succeed());await p.waitForFunction(()=>h.publishes.length===1);
 await p.setViewportSize({width:820,height:1180});const tabletCard=await p.getByLabel('Your pending Beauty post').boundingBox();await p.screenshot({path:directory+'/beauty-pending-tablet.png'});
 await p.evaluate(()=>h.publishes[0].reject(Error('fixture lost response')));await p.waitForFunction(()=>qa.state.pendingPost?.phase==='unknown');
 await p.setViewportSize({width:390,height:844});
 const sizes=await p.getByLabel('Your pending Beauty post').getByRole('button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width})));
 assert.ok(sizes.length>0&&sizes.every(button=>button.height>=44&&button.width>=44));
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
 await p.screenshot({path:directory+'/beauty-pending-recovery-phone.png'});
 writeFileSync(directory+'/beauty-visual-evidence.json',JSON.stringify({actualComponent:true,actualComposerDialog:true,actualStyles:true,mockedSurroundingModules:true,mockedActions:true,mockedUploadTransport:true,syntheticImage:true,production:false,physicalDeviceAcceptance:false,viewports:[{width:390,height:844},{width:820,height:1180}],pendingCardBounds:{phone:phoneCard,tablet:tabletCard},recoveryControls:sizes,horizontalOverflow:overflow,componentSha256:createHash('sha256').update(readFileSync('app/beauty/beauty-profile-client.tsx')).digest('hex')},null,2));
});
