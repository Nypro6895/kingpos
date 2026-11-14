import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright-core';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

// Opt-in: the actual Next routes and API write only to this test's own,
// network-disabled Supabase containers. No production login or provider charge.
test('actual Portable Gift checkout, Ticket details and Reports against the complete isolated schema',{
  skip:process.env.RUN_GIFT_TICKET_APP_QA!=='1',timeout:600000,
},async t=>{
  const out=resolve(process.env.GIFT_TICKET_APP_OUTPUT||'artifacts/gift-ticket-qa-seller/actual-app');
  await fs.mkdir(out,{recursive:true});
  const f=await startIsolatedSupabase('gift-ticket-app',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});
  let app,browser,gateway,appLog='';const checks=[],errors=[];
  t.after(async()=>{
    await browser?.close();
    if(app?.pid&&app.exitCode===null){
      if(process.platform==='win32'){
        try{execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{app.kill();}
      }else app.kill('SIGTERM');
    }
    if(gateway)await new Promise(done=>gateway.close(done));
    await fs.writeFile(join(out,'next.log'),f.redact(appLog).replace(/(token:\s*)'[^']*'/g,"$1'[fixture-redacted]'").replace(/(LiveDraft\()"[^"]*"/g,'$1"[fixture-redacted]"'));
    f.close();
  });
  const owner=f.person('gift-ui-owner');
  const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Synthetic Gift QA'})[0].account_id;
  const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:randomUUID(),p_name:'Synthetic Gift QA',p_owner_is_staff:true,p_country:'US'}).salon_id;
  const staff=f.sql(`select id from staff where salon_id='${salon}' limit 1`),service=randomUUID(),key=randomUUID();
  f.sql(`update public.users set display_name='Counter operator' where id='${owner.profileId}';
    update staff set display_name='Kim',pos_enabled=true,is_active=true where id='${staff}';
    update pos_settings set staff_check_in_enabled=false where salon_id='${salon}';
    insert into services(id,salon_id,name,base_price) values('${service}','${salon}','Full Set',50);
    insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,capabilities)
    values('${key}','${salon}','${randomUUID()}','fixture-salt','fixture-digest',array['portable.pos.use','portable.today.view','portable.report.view']);`);
  const signature=f.sql(`select pos_portable_access_signature('${key}','fixture-digest')`);
  f.rpc(owner,'gift_card_owner',{p_salon:salon,p_op:'install',p_args:{installed:true}});
  const docker=process.env.TEST_DOCKER_PATH||(process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker');
  const dockerContext=process.env.TEST_DOCKER_CONTEXT||(process.platform==='win32'?'desktop-linux':'default');
  const db=f.evidence.containers.db;
  const meta=JSON.parse(execFileSync(docker,['--context',dockerContext,'inspect',db],{encoding:'utf8'}))[0];
  assert.equal(meta.HostConfig.NetworkMode,'none');assert.ok(meta.Config.Labels['com.codex.task']);
  gateway=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://fixture');
      if(url.pathname==='/qa/login/portable'||url.pathname==='/qa/login/owner'){
        const values=url.pathname.endsWith('/owner')?[
          `sb-access-token=${owner.token}; Path=/; HttpOnly; SameSite=Lax`,
          `kingpos-selected-workspace=manage:${salon}; Path=/; SameSite=Lax`,
          `kingpos-current-manage-salon-id=${salon}; Path=/; SameSite=Lax`,
          `kingpos-current-account-id=${account}; Path=/; SameSite=Lax`,
        ]:[`kingpos-portable-pos-key-id=${key}; Path=/; HttpOnly; SameSite=Lax`,
          `kingpos-portable-pos-session=${signature}; Path=/; HttpOnly; SameSite=Lax`];
        res.setHeader('Set-Cookie',values);res.end('Synthetic test session');return;
      }
      const auth=url.pathname.startsWith('/auth/v1/'),storage=url.pathname.startsWith('/storage/v1/');
      const prefix=auth?'/auth/v1':storage?'/storage/v1':'/rest/v1';
      if(!url.pathname.startsWith(prefix+'/')){res.statusCode=404;res.end();return;}
      let body='';for await(const chunk of req)body+=chunk;
      const headers=['prefer','accept','range','content-type','authorization'].filter(k=>req.headers[k]&&(k!=='authorization'||req.headers[k].split('.').length===3)).map(k=>'header = '+JSON.stringify(k+': '+req.headers[k]));
      const config=['url = '+JSON.stringify('http://127.0.0.1:'+(auth?9999:storage?5000:3000)+url.pathname.slice(prefix.length)+url.search),
        'request = '+JSON.stringify(req.method),'silent','show-error','include','max-time = 30',...headers,body?'data = '+JSON.stringify(body):''].filter(Boolean).join('\n');
      const raw=await new Promise((done,reject)=>{
        const child=spawn(docker,['--context',dockerContext,'exec','-i',db,'curl','--config','-'],{windowsHide:true});
        let output='';child.stdout.on('data',chunk=>output+=chunk);child.on('error',reject);
        child.on('close',code=>code===0?done(output):reject(Error('Isolated fixture gateway failed')));child.stdin.end(config);
      });
      const separator=raw.includes('\r\n\r\n')?'\r\n\r\n':'\n\n',index=raw.indexOf(separator),head=raw.slice(0,index);
      res.statusCode=Number(head.match(/^HTTP\/\S+ (\d+)/)?.[1]||500);
      for(const header of head.split(/\r?\n/).slice(1)){
        const i=header.indexOf(':');if(i<0)continue;const name=header.slice(0,i).toLowerCase();
        if(['content-type','content-range','range-unit'].includes(name))res.setHeader(name,header.slice(i+1).trim());
      }
      res.end(raw.slice(index+separator.length));
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:f.redact(error.message)}));}
  });
  await new Promise(done=>gateway.listen(0,'127.0.0.1',done));
  // Next's local Request.url uses localhost. Use the same origin in the
  // browser so the real device/API origin checks are exercised unchanged.
  const proxyOrigin='http://localhost:'+gateway.address().port;
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));
  const appPort=reservation.address().port;await new Promise(done=>reservation.close(done));
  const origin='http://localhost:'+appPort;
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(appPort)],{
    cwd:process.cwd(),windowsHide:true,env:{...process.env,
      NEXT_PUBLIC_SUPABASE_URL:proxyOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-fixture-public-key',
      SUPABASE_SERVICE_ROLE_KEY:f.serviceToken,KINGPOS_DISABLE_BACKGROUND_DISPATCH:'1',REYLUMI_DISABLE_BACKGROUND_DISPATCH:'1',
      KINGPOS_BUILD_OUTPUT:'.next-gift-ticket-actual-qa'},stdio:['ignore','pipe','pipe'],
  });
  app.stdout.on('data',chunk=>appLog+=chunk);app.stderr.on('data',chunk=>appLog+=chunk);
  await new Promise((done,reject)=>{
    const deadline=setTimeout(()=>{clearInterval(timer);reject(Error('Local Next server did not become ready'));},90000);
    const timer=setInterval(()=>{if(/Ready in/.test(appLog)){clearInterval(timer);clearTimeout(deadline);done();}else if(app.exitCode!==null){clearInterval(timer);clearTimeout(deadline);reject(Error(f.redact(appLog)));}},100);
  });
  console.log('Actual source UI ready at '+origin+' with a network-isolated fixture.');
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const portable=await browser.newContext({viewport:{width:1440,height:1000}}),ownerContext=await browser.newContext({viewport:{width:1440,height:1000}});
  for(const context of [portable,ownerContext]){
    await context.route('**/*',route=>[origin,proxyOrigin].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
    context.on('page',page=>{page.setDefaultTimeout(45000);page.on('pageerror',error=>errors.push(error.message));});
  }
  await portable.request.get(proxyOrigin+'/qa/login/portable');await ownerContext.request.get(proxyOrigin+'/qa/login/owner');
  const page=await portable.newPage(),detail=await ownerContext.newPage();
  async function go(path,target=page){await target.goto(origin+path,{timeout:120000});}
  async function addGift(method){
    await page.getByRole('button',{name:'Buy a card',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Gift card',exact:true});
    await dialog.getByRole('textbox',{name:'Gift card amount',exact:true}).fill('100');
    await dialog.getByRole('button',{name:'Add $100 to purchase',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await page.getByText('To purchase: $100.00',{exact:true}).waitFor();
    await page.locator('.gc-sale-payment').getByRole('button',{name:method,exact:true}).click();
  }
  async function submitGift(){
    const before=Number(f.sql(`select count(*) from gift_card_counter_sales where salon_id='${salon}'`));
    await page.getByRole('button',{name:'Submit',exact:true}).click();
    await page.getByRole('heading',{name:'Your gift card is ready',exact:true}).waitFor();
    assert.equal(Number(f.sql(`select count(*) from gift_card_counter_sales where salon_id='${salon}'`)),before+1);
    const sale=f.json(`select json_build_object('id',s.id,'ticket',s.service_ticket_id,'amount',s.amount_cents,'method',s.payment_method,'number',t.ticket_number,'last4',(select last4 from gift_cards where id=s.card_id)) from gift_card_counter_sales s join pos_tickets t on t.id=s.service_ticket_id where s.salon_id='${salon}' order by s.created_at desc limit 1`);
    assert.equal(sale.amount,10000);assert.ok(sale.number);
    await page.getByText(sale.number,{exact:false}).first().waitFor();
    await page.screenshot({path:join(out,'success-'+before+'.png'),fullPage:true});
    await page.getByRole('button',{name:'Close gift card',exact:true}).click();
    return sale;
  }
  try{
    await go('/pos/portable');await page.getByRole('button',{name:'Buy a card',exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/Synthetic Gift QA/);console.log('Portable POS loaded.');
    await addGift('Cash');const only=await submitGift();
    assert.equal(only.method,'cash');console.log('Anonymous Gift-only Submit saved its numbered Ticket.');
    const anonymous=f.json(`select json_build_object('customer',customer_id,'items',(select count(*) from pos_ticket_items where pos_ticket_id=t.id),'turns',(select count(*) from pos_ticket_item_turn_parts where ticket_id=t.id),'earnings',(select count(*) from pos_ticket_staff_earnings where ticket_id=t.id)) from pos_tickets t where id='${only.ticket}'`);
    assert.deepEqual(anonymous,{customer:null,items:0,turns:0,earnings:0});checks.push('Gift-only submitted anonymously once with a real numbered Ticket and no staff work');
    await go('/pos/portable/ticket');await page.locator('[data-ticket-gift-item]').waitFor();
    assert.equal(await page.locator('[data-ticket-gift-staff]').innerText(),'');assert.doesNotMatch(await page.locator('body').innerText(),/Sold by/);
    assert.match(await page.locator('[data-compact-ticket]').innerText(),/Total \$100.00/);await page.screenshot({path:join(out,'portable-gift-only.png'),fullPage:true});
    checks.push('Portable Ticket loads the actual stored Gift source, one total and a blank staff column');
    await go('/pos-tickets/'+only.ticket,detail);await detail.locator('[data-ticket-gift-item]').waitFor();
    assert.equal(await detail.locator('[data-ticket-gift-staff]').innerText(),'');assert.doesNotMatch(await detail.locator('body').innerText(),/Sold by/);
    await detail.screenshot({path:join(out,'owner-gift-only-detail.png'),fullPage:true});checks.push('Owner detail loads the same anonymous Gift Ticket without seller attribution');console.log('Portable and Owner Gift-only Ticket reads passed.');
    // Original checkout lifetime has elapsed. The actual dedicated API must
    // retrieve the same unclaimed card without reviving that checkout.
    f.sql(`update gift_card_sessions set expires_at=now()-interval '1 minute',completed_at=now()-interval '11 minutes' where id=(select session_id from gift_card_counter_sales where id='${only.id}')`);
    const deliveryBefore=f.json(`select json_build_object('cards',(select count(*) from gift_cards where salon_id='${salon}'),'sales',(select count(*) from gift_card_counter_sales where salon_id='${salon}'),'ledger',(select count(*) from gift_card_ledger where salon_id='${salon}'))`);
    await go('/pos/portable');await page.getByRole('button',{name:'Use a card',exact:true}).click();
    await page.getByRole('textbox',{name:'Card code',exact:true}).waitFor();
    const nextGiftDialog=page.getByRole('dialog',{name:'Gift card',exact:true});
    assert.equal(await nextGiftDialog.getByRole('alert').count(),0,'Use starts a new customer session after the first sale');
    assert.doesNotMatch(await nextGiftDialog.innerText(),/Session expired or completed|Session changed or expired/);
    await page.getByRole('button',{name:'Close gift card',exact:true}).click();
    await page.getByRole('button',{name:'Buy a card',exact:true}).click();
    await page.getByRole('textbox',{name:'Gift card amount',exact:true}).waitFor();
    const currentSession=f.sql(`select id from gift_card_sessions where salon_id='${salon}' and status='open' order by created_at desc limit 1`);
    await detail.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.fixtureCopiedGift=value;}}});Object.defineProperty(navigator,'share',{configurable:true,value:async value=>{window.fixtureSharedGift=value.url;}});});
    const recoveryResponse=detail.waitForResponse(response=>response.url().endsWith('/api/gift-cards/ticket-delivery')&&response.request().method()==='POST');
    await detail.getByRole('button',{name:`Show gift card ${only.last4}`,exact:true}).click();
    const recovered=detail.getByRole('dialog',{name:'Ticket gift card',exact:true});
    await recovered.getByRole('img',{name:'Scan to receive gift card',exact:true}).waitFor();
    const recoveryData=await (await recoveryResponse).json();
    const recoveryUrl=origin+'/gift-cards#card='+recoveryData.token;
    await recovered.getByRole('button',{name:'Copy link',exact:true}).click();await recovered.getByRole('button',{name:'Link copied',exact:true}).waitFor();
    await recovered.getByRole('button',{name:'Share link',exact:true}).click();
    assert.equal(await detail.evaluate(()=>window.fixtureCopiedGift),recoveryUrl);assert.equal(await detail.evaluate(()=>window.fixtureSharedGift),recoveryUrl);
    assert.equal(f.sql(`select collected::text from gift_card_sessions where id=(select session_id from gift_card_counter_sales where id='${only.id}')`),'false','staff Copy/Share does not collect the customer card');
    const originalCard=f.json(`select json_build_object('id',c.id,'secret',gift_card_secret(c)) from gift_cards c join gift_card_counter_sales s on s.card_id=c.id where s.id='${only.id}'`);
    assert.equal(new URL(recoveryUrl).hash,'#card='+originalCard.secret);
    assert.equal(f.sql(`select id from gift_card_sessions where salon_id='${salon}' and status='open' order by created_at desc limit 1`),currentSession);
    assert.equal(await page.getByRole('textbox',{name:'Gift card amount',exact:true}).isVisible(),true,'old Ticket recovery leaves the next customer purchase open');
    assert.deepEqual(f.json(`select json_build_object('cards',(select count(*) from gift_cards where salon_id='${salon}'),'sales',(select count(*) from gift_card_counter_sales where salon_id='${salon}'),'ledger',(select count(*) from gift_card_ledger where salon_id='${salon}'))`),deliveryBefore);
    await recovered.screenshot({path:join(out,'owner-recovered-expired-gift.png')});
    await recovered.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Close gift card',exact:true}).click();
    await go('/pos/portable/ticket');
    const portableResponse=page.waitForResponse(response=>response.url().endsWith('/api/gift-cards/ticket-delivery')&&response.request().method()==='POST');
    await page.getByRole('button',{name:`Show gift card ${only.last4}`,exact:true}).click();
    const portableRecovery=page.getByRole('dialog',{name:'Ticket gift card',exact:true});
    await portableRecovery.getByRole('img',{name:'Scan to receive gift card',exact:true}).waitFor();
    assert.equal((await (await portableResponse).json()).token,recoveryData.token);
    await portableRecovery.getByRole('button',{name:'Done',exact:true}).click();
    checks.push('Buy auto-closes, next customer can Buy/Use, expired Gift delivery reopens the same card from Owner and Portable Tickets without changing current checkout or money');
    await go('/pos/portable');await page.getByRole('button',{name:/^Kim,/}).click();
    await page.getByRole('button',{name:/Full Set.*\$50/}).click();
    await page.getByText('No receipt lines yet.',{exact:true}).waitFor({state:'hidden'});
    await page.screenshot({path:join(out,'mixed-cart-before-gift.png'),fullPage:true});
    await addGift('Card');const mixed=await submitGift();assert.equal(mixed.method,'credit_card');console.log('Mixed service/Gift Submit saved.');
    assert.equal(Number(f.sql(`select sum(line_total) from pos_ticket_items where pos_ticket_id='${mixed.ticket}'`)),50);
    assert.equal(Number(f.sql(`select sum(amount) from pos_payments where ticket_id='${mixed.ticket}'`)),50);
    checks.push('Full Set by Kim plus Gift submits once; Gift funding is Card while the service payment remains canonical');
    await go('/pos/portable/ticket');await page.locator('[data-ticket-gift-item]').nth(1).waitFor();
    const mixedCard=page.locator('[data-compact-ticket]').filter({hasText:'Full Set'});
    assert.match(await mixedCard.innerText(),/Kim/);assert.match(await mixedCard.innerText(),/Total \$150.00/);
    assert.equal(await mixedCard.locator('[data-ticket-gift-staff]').innerText(),'');
    await page.screenshot({path:join(out,'portable-mixed-ticket.png'),fullPage:true});checks.push('Mixed Portable Ticket renders service staff and leaves Gift seller blank');
    const search=page.getByRole('searchbox',{name:'Search customer, staff, service, ticket #',exact:true});
    await search.fill('No matching ticket');await page.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===0);
    await search.fill('Gift');
    await page.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===2);
    await search.fill(mixed.last4);await page.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===1);
    assert.match(await page.locator('[data-compact-ticket]').innerText(),/Full Set/);
    await search.fill('Gift');await page.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===2);
    await search.fill('Kim');await page.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===1);
    assert.match(await page.locator('[data-compact-ticket]').innerText(),/Full Set/);
    await search.fill('');await page.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===2);
    checks.push('Portable search finds Gift labels and masked suffixes; Kim matches her service Ticket only');
    await mixedCard.getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByText('Gift amount stays unchanged',{exact:true}).waitFor();
    assert.doesNotMatch(await page.locator('[data-receipt-editor]').innerText(),/Sold by/);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();checks.push('Editing a service Ticket keeps the sold Gift outside editable staff inputs and can be cancelled');
    await go('/pos-tickets/'+mixed.ticket,detail);await detail.locator('[data-ticket-gift-item]').waitFor();
    assert.equal(await detail.locator('[data-ticket-gift-staff]').innerText(),'');await detail.screenshot({path:join(out,'owner-mixed-detail.png'),fullPage:true});
    checks.push('Owner mixed detail receives the same persisted Gift and service rows');
    await go('/pos-tickets',detail);await detail.locator('[data-ticket-gift-item]').nth(1).waitFor();
    const ownerSearch=detail.getByRole('searchbox',{name:'Search customer, staff, service, ticket #',exact:true});
    await ownerSearch.fill('No matching ticket');await detail.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===0);
    await ownerSearch.fill('Gift');await detail.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===2);
    await ownerSearch.fill(mixed.number);await detail.waitForFunction(()=>document.querySelectorAll('[data-ticket-gift-item]').length===1);
    assert.match(await detail.locator('[data-compact-ticket]').innerText(),/Full Set/);
    checks.push('Owner search finds both Gift sales and the original numbered mixed Ticket');
    await go('/pos/portable/report');await page.locator('[data-pos-collection-breakdown]').waitFor();
    assert.match(await page.locator('[data-pos-collection-breakdown]').innerText(),/\$200.00/);
    assert.match(await page.locator('[data-pos-collection-breakdown]').innerText(),/\$250.00/);
    const day=f.sql(`select get_salon_business_date('${salon}')`),collection=f.json(`select daily_input_reconciliation_values('${salon}','${day}')`);
    assert.equal(collection.giftSales,200);assert.equal(collection.grossService,50);assert.equal(collection.expectedService,250);
    await page.screenshot({path:join(out,'portable-report.png'),fullPage:true});checks.push('Portable Report and stored reconciliation include Gift funding once and preserve service production');
    assert.deepEqual(errors,[]);
    await fs.writeFile(join(out,'results.json'),JSON.stringify({passed:true,layer:'Actual Next Portable/Owner routes + API + complete network-isolated schema',checks,browserErrors:errors},null,2));
    console.log(JSON.stringify({passed:true,checks}));
  }catch(error){
    await page.screenshot({path:join(out,'failed.png'),fullPage:true}).catch(()=>{});
    console.log(f.redact((await page.locator('body').innerText().catch(()=>''))).slice(-3500));throw error;
  }
});
