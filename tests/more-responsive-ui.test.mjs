import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

async function inViewport(locator){const box=await locator.boundingBox();const viewport=locator.page().viewportSize();return box&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1;}

test('More fits each device, preserves role destinations and page drafts, and keeps Settings reachable', async () => {
  const shell = readFileSync('app/navigation-shell.tsx', 'utf8');
  // Exercise the production panel and dismissal hook without importing server/auth dependencies.
  const panel = shell.slice(shell.indexOf('function RoleMorePanel('), shell.indexOf('function CustomerDesktopMoreMenu('));
  const dismiss = shell.slice(shell.indexOf('function useDismissibleDetails('), shell.indexOf('function RoleMorePanel('));
  const stubs = {
    'next/link': `export default function Link({prefetch,onNavigate,href,onClick,...p}){return <a {...p} href={href} onClick={e=>{e.preventDefault();window.selectedHref=href;onClick?.(e)}}/>}`,
    'next/navigation': `export const usePathname=()=>'/pos';const search=new URLSearchParams();export const useSearchParams=()=>search;`,
    '@/components/workspace-language': `export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`,
  };
  stubs['@/components/feedback-link'] = stubs['next/link'];
  const result = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useRef,useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import{RoleMoreContent}from'./components/role-more-content';import{OwnerPosTabs}from'./app/pos/owner-pos-tabs';
import{ROLE_MORE_ITEMS}from'./app/role-navigation';
type RoleNavigationKind='personal'|'staff'|'owner';type SearchParamsReader=URLSearchParams;
const moreItemAsNavigationLink=x=>x;const isLinkActive=x=>x.href==='/pos';
${dismiss}
${panel}
const p=new URLSearchParams(location.search);const roleKind=p.get('role')||'owner';
window.expectedHrefs=ROLE_MORE_ITEMS[roleKind].map(x=>x.href).sort();
function Harness(){const ref=useDismissibleDetails();const[draft,setDraft]=useState('Draft ticket 125');return <>
<input aria-label="Existing draft" value={draft} onChange={e=>setDraft(e.target.value)}/>
<button id="outside">Outside</button>
{p.has('pos')?<OwnerPosTabs active="pos"/>:<details ref={ref}><summary>More</summary><RoleMorePanel pathname="/pos" roleKind={roleKind} searchParams={new URLSearchParams()} variant={p.get('variant')||'mobile'}/></details>}
</>};createRoot(document.getElementById('root')).render(<Harness/>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:undefined);
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:process.cwd()}));
  }}]});
  const source = readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "../../app";\n@source "../../components";');
  const css = (await postcss([tailwind()]).process(source,{from:'tests/fixtures/more-responsive.css'})).css+'\n'+result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
  const js = result.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font-family:Arial}summary{min-height:44px;padding:8px}#outside{margin:8px}</style><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script>`;
  const browser = await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const out='artifacts/more-responsive-20261106';mkdirSync(out,{recursive:true});
  const evidence=[];
  try {
    const page = await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://more.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
    for(const [width,height,variant] of [[320,568,'mobile'],[393,852,'mobile'],[768,1024,'mobile'],[1024,768,'sidebar'],[1280,800,'rail'],[1440,900,'desktop']]) {
      await page.setViewportSize({width,height});
      for(const role of ['personal','staff','owner']) {
        await page.goto(`http://more.test/?role=${role}&variant=${variant}`);
        await page.getByRole('textbox',{name:'Existing draft'}).fill('Keep this ticket');
        await page.locator('summary').click();
        const menu=page.locator('.role-more-panel');await menu.waitFor({state:'visible'});
        assert.deepEqual((await menu.locator('.role-more-item').evaluateAll(links=>links.map(a=>a.getAttribute('href')).sort())),await page.evaluate(()=>window.expectedHrefs));
        assert.equal(await menu.locator('a[href="/settings"]').count(),1);
        const rect=await menu.boundingBox();assert.ok(rect.x>=0 && rect.y>=0 && rect.x+rect.width<=width+1 && rect.y+rect.height<=height+1,JSON.stringify({width,height,rect}));
        if(width<768)assert.ok(rect.height>height*.78,'Use full available mobile height');
        const list=menu.locator('[data-role-more-items]');
        const scroll=await list.evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));
        if(height>=800)assert.ok(scroll.scroll<=scroll.client+1,JSON.stringify({width,height,role,scroll}));
        await list.evaluate(el=>{el.scrollTop=el.scrollHeight});
        assert.ok(await inViewport(menu.getByRole('link',{name:'All Settings',exact:true})));
        // Close restores focus and keeps the mounted page's existing draft.
        await menu.getByRole('button',{name:'Close',exact:true}).click();
        await menu.waitFor({state:'hidden'});assert.equal(await page.getByRole('textbox').inputValue(),'Keep this ticket');
        assert.equal(await page.locator('summary').evaluate(el=>el===document.activeElement),true);
        await page.locator('summary').click();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
        await page.locator('summary').click();await page.mouse.click(2,height-2);await menu.waitFor({state:'hidden'});
        await page.locator('summary').click();await menu.getByRole('link',{name:'All Settings',exact:true}).click();await menu.waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>window.selectedHref),'/settings');
        assert.equal(await page.getByRole('textbox').inputValue(),'Keep this ticket');
        evidence.push({width,height,role,variant,scroll:scroll.scroll>scroll.client+1});
        if(role==='owner'){await page.locator('summary').click();await menu.screenshot({path:`${out}/owner-${width}.png`});}
      }
    }
    // Real POS portal: full height on phones, tablet side panel and wide desktop.
    for(const [width,height] of [[393,852],[768,1024],[1024,768],[1440,900]]){
      await page.setViewportSize({width,height});await page.goto('http://more.test/?pos=1');
      await page.getByRole('button',{name:'More',exact:true}).press('Enter');const menu=page.locator('[data-owner-more-popover]');await menu.waitFor();
      const box=await menu.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=height+1&&box.x>=0&&box.x+box.width<=width+1);
      await menu.getByRole('button',{name:'Close',exact:true}).click();await menu.waitFor({state:'detached'});
      assert.equal(await page.getByRole('button',{name:'More',exact:true}).evaluate(el=>el===document.activeElement),true);
      evidence.push({width,height,role:'POS',closeRestoresFocus:true});
    }
    // Large text remains readable; only the body scrolls, Settings stays visible.
    await page.setViewportSize({width:320,height:568});await page.goto('http://more.test/?role=owner');await page.locator('summary').click();
    await page.addStyleTag({content:'.role-more-item,.role-more-settings{font-size:22px}.role-more-group h3{font-size:18px}'});
    const list=page.locator('[data-role-more-items]');assert.ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight));
    await list.evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.ok(await inViewport(page.getByRole('link',{name:'All Settings',exact:true})));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);writeFileSync(out+'/responsive-verification.json',JSON.stringify({evidence,largeText:'passed',pageErrors:errors},null,2));
  } finally { await browser.close(); }
});
