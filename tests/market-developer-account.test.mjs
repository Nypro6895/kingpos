import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const req=createRequire(import.meta.url);
const compiled=await build({entryPoints:['app/(market-platform)/developer-platform/account-panel.tsx','lib/market-platform/developer-profile.ts'],bundle:true,write:false,outdir:'virtual',platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'render-boundaries',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime)$/},a=>({path:pathToFileURL(req.resolve(a.path)).href,external:true}));
 b.onResolve({filter:/^(next\/link|@\/components\/workspace-language|\.\/form|\.\/sections)$|\.css$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/link'?'import React from "react";export default function Link({children,prefetch,...props}){return React.createElement("a",props,children)}':a.path.includes('workspace-language')?'export function WorkspaceText({text}){return text}':a.path==='./form'?'import React from "react";export function PlatformForm({children,operation,label}){return React.createElement("form",{"data-operation":operation},children,React.createElement("button",null,label))}':a.path==='./sections'?'import React from "react";export function DeveloperText({text}){return text};export function DeveloperLanguagePicker(){return null};export function DeveloperPanelLink({panel,children}){return React.createElement("a",{href:"/developer-platform?panel="+panel},children)};export function PortalJump({children}){return React.createElement("button",null,children)}':'export default new Proxy({},{get:(_,key)=>key});',resolveDir:process.cwd()}));
}}]});
const modules=await Promise.all(compiled.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
const {DeveloperAccountPanel}=modules.find(m=>m.DeveloperAccountPanel),{readPublisherProfile}=modules.find(m=>m.readPublisherProfile);
const organization={id:'synthetic-org',name:'Synthetic publisher'},profile={email:'support@example.invalid',website:'https://example.com',description:'Synthetic public profile'};
const render=props=>renderToStaticMarkup(React.createElement(DeveloperAccountPanel,{organization,available:true,...props}));
test('missing/malformed profile reads stay unavailable, distinct from an explicitly absent first profile',()=>{
 assert.equal(readPublisherProfile(null),null);
 for(const value of [undefined,{},[],false,{...profile,email:12},{email:'x',website:'y'}])assert.equal(readPublisherProfile(value),undefined);
});
test('profile projection excludes private/provider and unexpected fields',()=>{assert.deepEqual(readPublisherProfile({...profile,password:'not-a-real-secret',bank:'not-a-real-bank'}),profile);});
test('successful SQL null permits first profile creation',()=>{const html=render({profile:null});assert.match(html,/data-operation="profile"/);assert.match(html,/name="email"/);assert.doesNotMatch(html,/could not be loaded/);});
test('unavailable or missing profile cannot become an editable blank form',()=>{for(const props of [{profile:undefined},{profile,available:false}]){const html=render(props);assert.doesNotMatch(html,/data-operation="profile"/);assert.match(html,/Reload publisher profile/);assert.match(html,/href="\/account"/);assert.match(html,/href="\/settings\/login-security"/);}});
test('publisher fields are grouped and escape saved values without interpreting markup',()=>{const html=render({profile:{...profile,description:'<img src=x onerror=alert(1)>'}});assert.match(html,/Public publisher profile/);assert.match(html,/pattern="https:\/\/.\+"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);});
test('organization setup is explicit and never substitutes another user account',()=>{const html=render({organization:null,profile:null});assert.match(html,/Set up developer organization/);assert.doesNotMatch(html,/data-operation="profile"/);assert.match(html,/account you already have/);});
test('security links do not fabricate MFA or session status',()=>{const html=render({profile});assert.match(html,/does not confirm that two-factor authentication is enabled/);assert.match(html,/Password|password/);assert.match(html,/active sessions/);});
test('a different publisher organization gets an independent form-state boundary',()=>{
 const findForm=node=>{if(!React.isValidElement(node))return undefined;if(node.props.operation==='profile')return node;for(const child of React.Children.toArray(node.props.children)){const found=findForm(child);if(found)return found;}};
 const formA=findForm(DeveloperAccountPanel({organization:{id:'synthetic-a',name:'A'},profile,available:true}));
 const formB=findForm(DeveloperAccountPanel({organization:{id:'synthetic-b',name:'B'},profile,available:true}));
 assert.ok(formA&&formB);assert.notEqual(formA.key,null);assert.notEqual(formA.key,formB.key);
});
test('all account panel DeveloperText copy has a Vietnamese counterpart',()=>{const source=fs.readFileSync('app/(market-platform)/developer-platform/account-panel.tsx','utf8'),copy=JSON.parse(fs.readFileSync('lib/vietnamese-developer-market.json','utf8'));for(const match of source.matchAll(/<DeveloperText text="([^"]+)"/g))assert.ok(copy[match[1]],'Missing Vietnamese copy: '+match[1]);});

const pageKey=Symbol.for('market-account-page-test');
globalThis[pageKey]={profile:null};
const pageBuild=await build({entryPoints:['app/(market-platform)/developer-platform/page.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'page-read-boundaries',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime)$/},a=>({path:pathToFileURL(req.resolve(a.path)).href,external:true}));
 b.onResolve({filter:/^(next\/link|next\/server|@\/lib\/market-platform\/(server|accounting)|@\/components\/workspace-language|\.\/form|\.\/sections)$|\.css$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/server'?'export async function connection(){}':a.path==='next/link'?'import React from "react";export default function Link({children,prefetch,...props}){return React.createElement("a",props,children)}':a.path.endsWith('/accounting')?'export function commerceSummary(){throw Error("Unavailable commerce must not render accounting")};export function dollars(){return "unused"}':a.path.endsWith('/server')?`export class PlatformError extends Error{};export const platformEnabled=()=>true;export async function platformRpc(name){const s=globalThis[Symbol.for('market-account-page-test')];if(name==='workspace')return {organization:{id:'synthetic',name:'Synthetic publisher'},reviewer:false,apps:[],queue:[],sandboxes:[]};if(name==='developer_tools')return {profile:s.profile,readiness:[],sandboxGroups:[]};throw Error('Synthetic independent read unavailable');}`:a.path.includes('workspace-language')?'export function WorkspaceText({text}){return text}':a.path==='./form'?'import React from "react";export function PlatformForm({children,operation,label}){return React.createElement("form",{"data-operation":operation},children,React.createElement("button",null,label))}':a.path==='./sections'?'import React from "react";export function DeveloperPortal({children}){return children};export function PortalSection({children,id}){return React.createElement("section",{id},children)};export function DeveloperSaveNotice(){return null};export function PortalNavigation(){return null};export function DeveloperText({text}){return text};export function DeveloperLanguagePicker(){return null};export function DeveloperPanelLink({panel,children}){return React.createElement("a",{href:"/developer-platform?panel="+panel},children)};export function PortalJump({children}){return React.createElement("button",null,children)}':'export default new Proxy({},{get:(_,key)=>key});',resolveDir:process.cwd()}));
}}]});
const page=await import('data:text/javascript;base64,'+Buffer.from(pageBuild.outputFiles[0].text).toString('base64'));
async function renderPage(profileValue){globalThis[pageKey].profile=profileValue;const shell=page.default({searchParams:Promise.resolve({panel:'account'})});return renderToStaticMarkup(await shell.props.children.type(shell.props.children.props));}
test('actual page preserves first publisher setup on successful explicit-null read',async()=>{assert.match(await renderPage(null),/data-operation="profile"/);});
test('actual page blocks malformed publisher reads instead of publishing a blank form',async()=>{const html=await renderPage({email:'partial'});assert.doesNotMatch(html,/data-operation="profile"/);assert.match(html,/Reload publisher profile/);});
test('actual page has a visible retry panel when independent commerce reads fail',async()=>{const html=await renderPage(profile);assert.match(html,/id="commerce"/);assert.match(html,/Payment information could not be loaded/);assert.match(html,/Reload payment information/);assert.doesNotMatch(html,/0\.00 USD|Observed platform balance movements/);});
test('actual page accepts only supported developer display languages from the URL',async()=>{
 for(const [lang,expected] of [['vi','vi'],['en','en'],['unexpected','en']]){const shell=page.default({searchParams:Promise.resolve({panel:'account',lang})});const view=await shell.props.children.type(shell.props.children.props);assert.equal(view.props.initialLanguage,expected);}
});
test('direct finance/review URLs cannot select a missing privileged section',async()=>{for(const panel of ['finance','review']){const shell=page.default({searchParams:Promise.resolve({panel})});const view=await shell.props.children.type(shell.props.children.props);assert.equal(view.props.initialPanel,'overview');assert.equal(view.props.availablePanels.includes(panel),false);assert.match(renderToStaticMarkup(view),/This section is unavailable for your account/);}});
test.after(()=>delete globalThis[pageKey]);

const languageBuild=await build({entryPoints:['app/(market-platform)/developer-platform/sections.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'language-ui-boundaries',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime)$/},a=>({path:pathToFileURL(req.resolve(a.path)).href,external:true}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'import React from "react";export default function Link({children,prefetch,...props}){return React.createElement("a",props,children)}',resolveDir:process.cwd()}));
}}]});
const locale=await import('data:text/javascript;base64,'+Buffer.from(languageBuild.outputFiles[0].text).toString('base64'));
function languageHtml(language){return renderToStaticMarkup(React.createElement(locale.DeveloperPortal,{initialLanguage:language},React.createElement(locale.DeveloperText,{text:'Profile & account security'}),React.createElement(locale.DeveloperLanguagePicker),React.createElement(locale.DeveloperPanelLink,{panel:'account'},'Reload')));}
test('actual developer language context renders Vietnamese and preserves it in reload links',()=>{const html=languageHtml('vi');assert.match(html,/Hồ sơ &amp; bảo mật tài khoản/);assert.match(html,/value="vi" selected/);assert.match(html,/panel=account&amp;lang=vi/);});
test('English remains the explicit default without a salon language entitlement',()=>{const html=languageHtml('en');assert.match(html,/Profile &amp; account security/);assert.match(html,/panel=account&amp;lang=en/);});
