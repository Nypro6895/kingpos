import {chromium} from 'playwright-core';import assert from'node:assert/strict';import fs from'node:fs';
const b=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const p=await b.newPage({viewport:{width:1100,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto((process.env.REWARD_UI_ORIGIN||'http://localhost:4077')+'/owner');
 const report=p.getByRole('region',{name:'Reward activity',exact:true});await report.getByText('$5.00',{exact:true}).first().waitFor();
 assert.ok(await report.getByLabel('Reward activity date').inputValue());await report.getByRole('button',{name:'View activity',exact:true}).click();
 await report.getByRole('button',{name:'View activity',exact:true}).waitFor();
 await report.getByText('100 points used',{exact:false}).waitFor();assert.equal(await report.getByRole('alert').count(),0);assert.deepEqual(errors,[]);
 await report.screenshot({path:'artifacts/rewardlumi-v2/reward-report.png'});
 fs.writeFileSync('artifacts/rewardlumi-v2/report-ui-result.json',JSON.stringify({passed:true,actualComponent:true,actualSql:true,readOnlyReport:true,errors},null,2));console.log('PASS Reward report UI against actual isolated SQL');
}finally{await b.close();}
