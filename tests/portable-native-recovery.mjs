import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {_electron} from 'playwright-core';
const dir=mkdtempSync(join(tmpdir(),'kingpos-recovery-'));
const server=createServer((req,res)=>{
  if(req.url==='/api/pos/connection'){res.setHeader('content-type','application/json');res.end('{"available":true}');return;}
  res.setHeader('content-type','text/html');res.end('<main data-portable-pos-shell>Recovered workspace</main>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
await new Promise(r=>server.close(r));
const env={...process.env,KINGPOS_DESKTOP_TEST_ORIGIN:`http://127.0.0.1:${port}`,KINGPOS_DESKTOP_TEST_PROFILE:dir};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await _electron.launch({executablePath:resolve('desktop/node_modules/electron/dist/electron.exe'),args:[resolve('desktop')],env});
  const page=await app.firstWindow();
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor({state:'visible'});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  await page.getByText('Recovered workspace',{exact:true}).waitFor({timeout:25000});
  assert.equal(new URL(page.url()).origin,env.KINGPOS_DESKTOP_TEST_ORIGIN);
  await assert.rejects(page.evaluate(()=>window.kingposDesktop.recovery.retry()),/Access denied/);
  console.log('PASS: empty profile starts without server; retry remains usable; app recovers automatically when server starts.');
}finally{await app?.close();if(server.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
