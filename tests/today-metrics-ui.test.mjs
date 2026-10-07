import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test(
  "Today metric tones: desktop and mobile presentation",
  { skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH)
    );
    const repo = resolve(".").replaceAll("\\", "/"),
      scratch = mkdtempSync(join(tmpdir(), "requests-ui-"));
    const entry = join(scratch, "entry.tsx");
    writeFileSync(
      entry,
      `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {MetricCard,AttentionPanel} from '${repo}/app/(app)/staff/today/page';
      const chart={kind:'sparkline',ariaLabel:'Sales',points:[{label:'9 AM',value:0},{label:'10 AM',value:300}]};
      const metrics=[{label:'Sales Today',value:'$2,659',tone:'good',chart,detail:'35 closed tickets',trend:{direction:'up',label:'$350 above 7-day average at this time ($2,309)'}},{label:'Appointments',value:'12',tone:'default',detail:'4 completed / 8 upcoming',assessment:'Appointments in progress or scheduled'},{label:'Waiting',value:'5',tone:'danger',detail:'Clients waiting for service',assessment:'Longest wait: 32 min'},{label:'Staff Working',value:'4',tone:'warning',detail:'4 checked in now',assessment:'Queue exceeds checked-in staff'}];
      createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'auto',padding:16}}><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metrics.map(m=><MetricCard key={m.label} metric={m}/>)}</div><AttentionPanel items={[{id:'open',label:'6 open POS tickets',detail:'Review open tickets',tone:'notice',count:6,href:null}]}/><AttentionPanel items={[{id:'all-good',label:'All good',detail:'Nothing needs attention',tone:'good',href:null}]}/></main>);`,
    );
    const bundle = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      jsx: "automatic",
      platform: "browser",
      nodePaths: [join(repo, "node_modules")],
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "fixture",
          setup(b) {
            b.onLoad({filter:/staff[\\/]today[\\/]page\.tsx$/},args=>({loader:'tsx',contents:readFileSync(args.path,'utf8').replace('function MetricCard(', 'export function MetricCard(').replace('function AttentionPanel(', 'export function AttentionPanel(')}));
            b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'mock'}));
            b.onResolve({filter:/owner-market-promo$/},()=>({path:'market',namespace:'mock'}));
            b.onLoad({filter:/^market$/,namespace:'mock'},()=>({contents:`export const OwnerMarketPromo=()=>null;`}));
            b.onResolve({filter:/current-context$/},()=>({path:'context',namespace:'mock'}));
            b.onLoad({filter:/^context$/,namespace:'mock'},()=>({contents:`export const isOwnerMembership=()=>false;`}));
            b.onResolve({filter:/(today-dashboard|route-context-guards|quick-access-editor|pos-workspace-realtime-refresh)$/},()=>({path:'server',namespace:'mock'}));
            b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({resolveDir:repo,contents:path==='link'?`import React from 'react'; export default function Link({children,...p}){return React.createElement('a',p,children)}`:`export const getTodayDashboard=()=>{}; export const requireSalonManagePageContext=()=>{}; export const QuickAccessPanel=()=>null; export const PosWorkspaceRealtimeRefresh=()=>null;`}));
          },
        },
      ],
    });
    const css = await postcss([tailwind({ base: repo })]).process(
      `@import "tailwindcss" source(none); @source "${repo}/app/(app)/staff/today/page.tsx"; @source "${repo}/app/my-place/place-ui.tsx"; body{font-family:Arial;margin:0}`,
      { from: join(repo, "reports-qa.css") },
    );
    const server = createServer((req, res) => {
      if (req.url === "/bundle.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(bundle.outputFiles[0].text);
      } else if (req.url === "/style.css") {
        res.setHeader("content-type", "text/css");
        res.end(css.css);
      } else
        res.end(
          '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
        );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.TEST_BROWSER_PATH,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/reports`);
      await page.getByText('Sales Today',{exact:true}).waitFor();
      assert.equal(await page.locator('.text-emerald-700').count()>0,true);
      assert.equal(await page.locator('.text-red-700').count()>0,true);
      await page.getByText('6 to review',{exact:true}).waitFor();
      await page.getByText('All clear',{exact:true}).waitFor();
      mkdirSync('artifacts/today-metrics-qa',{recursive:true});
      await page.screenshot({path:'artifacts/today-metrics-qa/desktop.png',fullPage:true});
      for(const width of [390,320]) { await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); }
      await page.screenshot({path:'artifacts/today-metrics-qa/mobile.png',fullPage:true});assert.deepEqual(errors,[]);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
