import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

// Real navigation/page markup with sample read results and no writable backend.
export async function pluginNavigationPreview() {
  const stubs = {
    '@/lib/campaign-payments': `export async function confirmCampaignCheckout(){return false};export async function cancelCampaignCheckout(){return true};`,
    '@/components/experience-page': `export const withExperiencePage=page=>page;`,
    'next/link': `export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,onNavigate,...props}){return <a {...props}/>} `,
    'next/navigation': `export function useRouter(){return{refresh(){},push(){},replace(){}}};export function redirect(url){window.redirected=url;throw Error('redirect:'+url)}`,
    '@/lib/current-context': `export const isSalonManageContext=c=>c.salonMode==='manage'&&c.workspaceType==='salon';export const isOwnerMembership=c=>!new URLSearchParams(location.search).has('denied');export async function getCurrentBusinessContext(){const role=new URLSearchParams(location.search).get('role');return{user:{id:'sample-owner'},salonMode:role==='staff'?'staff':'manage',workspaceType:role==='personal'?'personal':'salon'}}`,
    '@/app/campaigns/credit-actions': `export async function completeCampaignCardAction(){};export async function campaignWalletAction(){window.reads.push('wallet');return{installed:new URLSearchParams(location.search).has('active')}}`,
    '@/lib/owner-campaigns': `export async function requireCampaignOwner(installed=true){window.reads.push('owner:'+installed);if(new URLSearchParams(location.search).has('denied'))throw Error('Owner required');return{context:{currentSalon:{city:'Houston',state:'TX',country:'United States'}}}};export async function ownerCampaignSettings(){window.reads.push('settings');return{}}`,
    '@/app/campaigns/actions': `export async function loadOwnerCampaignsAction(){window.reads.push('campaigns');return{campaigns:[]}}`,
    '@/app/campaigns/campaign-workspace': `export function CampaignWorkspace(){return <main data-installed-workspace>Existing campaign workspace</main>}`,
    '@/components/workspace-language': `import{translateVietnamese}from'@/lib/vietnamese-dictionary';const t=x=>translateVietnamese(x,new URLSearchParams(location.search).has('vi'));export const useWorkspaceTranslation=()=>t;export const WorkspaceText=({text})=>t(text);`,
  };
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';import More from'./app/(app)/more/page';import Campaigns from'./app/(app)/campaigns/page';import{RoleMoreContent}from'./components/role-more-content';
window.reads=[];const params=new URLSearchParams(location.search);const root=createRoot(document.getElementById('root'));
function Preview({node}){const[visible,setVisible]=useState(true);window.setPageVisible=setVisible;return <Activity mode={visible?'visible':'hidden'}>{node}</Activity>}
const node=location.pathname==='/dropdown'?Promise.resolve(<div style={{width:360,margin:'24px auto'}}><RoleMoreContent roleKind={params.get('role')||'owner'} activeItemIds={[]} onNavigate={()=>{}}/></div>):(location.pathname==='/campaigns'?Campaigns({searchParams:Promise.resolve(Object.fromEntries(params))}):More());
node.then(node=>root.render(<React.StrictMode><Preview node={node}/></React.StrictMode>)).catch(error=>{if(!window.redirected)throw error;document.getElementById('root').textContent='Redirected';});
` }, bundle: true, write: false, outdir: 'fixture', jsx: 'automatic', plugins: [{ name: 'sample-read-results', setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: 'sample' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'sample' }, a => ({ loader: 'tsx', contents: stubs[a.path], resolveDir: process.cwd() }));
  } }] });
  const source = readFileSync('app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../../app";\n@source "../../components";');
  const css = (await postcss([tailwind()]).process(source, { from: 'tests/fixtures/plugin-navigation-preview.css' })).css + '\n' + bundle.outputFiles.filter(f => f.path.endsWith('.css')).map(f => f.text).join('\n');
  const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
  return createServer((req, res) => {
    const asset = req.url.startsWith('/bundle.js');
    res.setHeader('Content-Type', asset ? 'application/javascript' : 'text/html;charset=utf-8');
    res.end(asset ? js : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font-family:Arial,sans-serif}.sample-label{padding:8px;background:#fff7ed;color:#9a3412;text-align:center;font-size:12px}</style></head><body><div class="sample-label">Giao diện local · Dữ liệu mẫu · Chưa deploy</div><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
}
