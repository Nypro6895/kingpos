import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';
const source=fs.readFileSync('app/navigation-shell.tsx','utf8');
const current=source.match(/className="(fixed inset-0 z-\[80\][^"]*)"/)[1];
const before=current+' lg:hidden';
const input='@import "tailwindcss" source(none);\n@source inline("'+[current,before,'xl:hidden'].join(' ')+'");';
const {css}=await postcss([tailwind({base:process.cwd()})]).process(input,{from:path.resolve('app/globals.css')});
const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
const results=[];
try {
const page=await browser.newPage();
for(const width of [390,768,1023,1024,1180,1279,1280]) {
 await page.setViewportSize({width,height:768});
 for(const [revision,classes] of [['before',before],['after',current]]) {
 await page.setContent('<html><head><style>'+css+'</style></head><body><div class="xl:hidden"><button>Open account switcher</button><div role="dialog" class="'+classes+'"><aside style="width:400px;height:100vh;background:white;padding:20px"><h2>Switch account</h2><button>Personal</button><button>Staff</button><button>Owner</button></aside></div></div></body></html>');
 const trigger=await page.getByRole('button',{name:'Open account switcher'}).isVisible();
 const dialog=await page.getByRole('dialog').isVisible();
 if(revision==='after')assert.equal(dialog,trigger,'drawer and its trigger must share visibility at '+width);
 if(revision==='before' && width>=1024&&width<1280)assert.ok(trigger&&!dialog);
 results.push({revision,width,trigger,dialog});
 }
}
fs.writeFileSync('artifacts/ipad-role-switch/responsive-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
}finally{await browser.close()}
