import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

test('paired gift screens: shared design, close, delivery countdown, collection and next customer',{timeout:120000},async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useCallback,useRef,useState} from 'react';import{createRoot}from'react-dom/client';
    import{GiftPosControl,GiftCustomerControl,GiftDeliveryReceipt}from'./components/gift-card/pos-gift-card';
    function POS(){const checkout=useRef();const register=useCallback(fn=>{checkout.current=fn},[]);const[delivery,setDelivery]=useState(null);const[receipt,setReceipt]=useState({requestId:'cart-1',lines:[]});
      return <main><h1>Synthetic POS lifecycle</h1><GiftPosControl token='fixture-display' receipt={receipt} onCheckout={register} onDelivery={setDelivery}/><button onClick={async()=>{await checkout.current?.();setReceipt({requestId:crypto.randomUUID(),lines:[]})}}>Submit</button><GiftDeliveryReceipt session={delivery} onClose={()=>setDelivery(null)}/></main>;}
    createRoot(document.getElementById('root')).render(location.pathname==='/customer'?<GiftCustomerControl token='fixture-display'/>:<POS/>);
  `},bundle:true,write:false,outdir:'out',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const out=resolve('artifacts/windows-checkin-qa/browser');await mkdir(out,{recursive:true});
  const design=text=>({background:'#f3e9e1',color:'#24443d',image:'',logo:'',elements:[{id:'title',kind:'text',text,x:50,y:50,size:26,font:'serif'}]});
  let number=0;
  const fresh=()=>({id:'fixture-'+(++number),revision:1,prompt:0,mode:'use',entry:'code',status:'open',amount:0,total:0,purchase:0,card:null,approved:false,qrVisible:false,mobile:'fixture-mobile',expires:new Date(Date.now()+600000).toISOString(),dismissed:false});
  let session=fresh(),completedAge=0,failBuy=false;const ops=[],history=new Map();
  const server=createServer(async(req,res)=>{
    if(req.url==='/api/gift-cards'){
      let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);ops.push(q.op);
      res.setHeader('Content-Type','application/json');
      if(q.op==='appearance'){res.end(JSON.stringify({design:design('Owner saved design'),salonName:'Test salon'}));return;}
      if(q.op==='read'&&q.args.sessionId&&q.args.sessionId!==session.id&&history.has(q.args.sessionId)){res.end(JSON.stringify({installed:true,session:history.get(q.args.sessionId)}));return;}
      history.set(session.id,structuredClone(session));
      if(q.op==='sync'){
        const key=JSON.stringify(q.args.receipt);
        if(session.status==='completed'&&key!==session.receiptKey&&(session.dismissed||session.collected||Date.parse(session.completedAt)+60000<=Date.now()))session=fresh();
        if(session.status==='open')session.receiptKey=key;
      }
      if(q.op==='open'){
        await new Promise(r=>setTimeout(r,180));
        if(session.status!=='open'){const receiptKey=session.receiptKey;session=fresh();if(q.scope==='pos')session.receiptKey=receiptKey;}
        session={...session,mode:q.args.mode,entry:q.args.entry,prompt:session.prompt+1,revision:session.revision+1,dismissed:false,qrVisible:q.args.entry==='scan'};
      }
      if(q.op==='buy'&&failBuy){failBuy=false;res.statusCode=400;res.end(JSON.stringify({error:'Synthetic purchase unavailable'}));return;}
      if(q.op==='buy')session={...session,purchase:q.args.amount,dismissed:true,revision:session.revision+1};
      if(q.op==='dismiss'&&q.args.sessionId===session.id&&q.args.prompt===session.prompt&&q.args.status===session.status)session={...session,dismissed:true,qrVisible:false,revision:session.revision+1};
      if(q.op==='submit')session={...session,status:'completed',completedAt:new Date(Date.now()-completedAge).toISOString(),delivery:'a'.repeat(64),deliveryCard:{id:'issued',salonId:'salon',salonName:'Test salon',last4:'1234',balance:session.purchase,status:'active',generation:1,design:design('Issued gift design')},revision:session.revision+1,dismissed:false};
      history.set(session.id,structuredClone(session));
      res.end(JSON.stringify({installed:true,session}));return;
    }
    if(req.url==='/gift-cards/shared-default.webp'){res.setHeader('Content-Type','image/webp');res.end(await readFile('public/gift-cards/shared-default.webp'));return;}
    res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');
    res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const errors=[];
  try{
    const pos=await browser.newPage({viewport:{width:1426,height:953}}),customer=await browser.newPage({viewport:{width:1920,height:1080}});
    for(const page of [pos,customer]){page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));}
    await pos.goto(origin);await customer.goto(origin+'/customer');
    const pd=pos.getByRole('dialog',{name:'Gift card',exact:true}),cd=customer.getByRole('dialog',{name:'Gift card',exact:true});
    await pos.getByRole('button',{name:'Buy a card',exact:true}).click();
    assert.equal(await pd.count(),0,'wait for confirmed Buy mode before showing a dialog');
    await pd.getByRole('textbox',{name:'Gift card amount',exact:true}).waitFor();await cd.getByRole('textbox',{name:'Gift card amount',exact:true}).waitFor();
    await pd.getByText('Owner saved design',{exact:true}).waitFor();await cd.getByText('Owner saved design',{exact:true}).waitFor();
    await customer.bringToFront();await cd.getByRole('textbox',{name:'Gift card amount',exact:true}).fill('50');failBuy=true;await cd.getByRole('button',{name:'Add $50 to purchase',exact:true}).click();
    await cd.getByRole('alert').getByText('Synthetic purchase unavailable',{exact:true}).waitFor();assert.equal(await cd.isVisible(),true,'failed Buy keeps editor open');assert.equal(session.purchase,0);
    await cd.getByRole('button',{name:'Add $50 to purchase',exact:true}).click();await cd.waitFor({state:'hidden'});await pos.bringToFront();await pd.waitFor({state:'hidden'});
    await pos.getByText('To purchase: $50.00',{exact:true}).waitFor();
    await pos.screenshot({path:join(out,'pos-shared-buy.png')});await customer.screenshot({path:join(out,'customer-shared-buy.png')});
    assert.equal(session.purchase,5000,'close preserves pending purchase');await customer.reload();assert.equal(await cd.count(),0,'reload does not reopen a dismissed Buy screen');
    await pos.bringToFront();await pos.getByRole('button',{name:'Use a card',exact:true}).click();await pd.getByRole('textbox',{name:'Card code',exact:true}).fill('AB1234');await pd.getByLabel('Security PIN',{exact:true}).fill('12345678');
    await pd.getByRole('button',{name:'Customer wallet',exact:true}).waitFor();assert.equal(await cd.getByRole('button',{name:'Customer wallet',exact:true}).count(),0);
    history.set(session.id,{...session,status:'cancelled',revision:session.revision+1});session=fresh();await pd.waitFor({state:'hidden'});await cd.waitFor({state:'hidden'});
    await pos.getByRole('button',{name:'Use a card',exact:true}).click();await pd.getByRole('textbox',{name:'Card code',exact:true}).waitFor();
    assert.equal(await pd.getByRole('textbox',{name:'Card code',exact:true}).inputValue(),'');assert.equal(await pd.getByLabel('Security PIN',{exact:true}).inputValue(),'');
    await pd.getByRole('button',{name:'Buy a gift card',exact:true}).click();await pd.getByRole('textbox',{name:'Gift card amount',exact:true}).fill('25');await pd.getByRole('button',{name:'Add $25 to purchase',exact:true}).click();
    await pd.waitFor({state:'hidden'});
    await pos.locator('.gc-sale-payment').getByRole('button',{name:'Cash',exact:true}).click();await pos.getByRole('button',{name:'Submit',exact:true}).click();await pd.getByRole('heading',{name:'Your gift card is ready',exact:true}).waitFor();await pd.getByText('Issued gift design',{exact:true}).waitFor();
    await customer.bringToFront();await cd.getByText('Issued gift design',{exact:true}).waitFor();assert.equal(await cd.getByText('Owner saved design',{exact:true}).count(),0,'issued artwork snapshot wins');
    await pd.getByRole('link',{name:'Open / share / save image',exact:true}).waitFor();await pd.getByRole('button',{name:'Done',exact:true}).waitFor();await cd.getByRole('button',{name:'Done',exact:true}).waitFor();
    for(const [page,d,label] of [[pos,pd,'pos'],[customer,cd,'customer']]){
      assert.equal(await d.locator('.gc-approved-complete').count(),1);
      const box=await d.boundingBox(),v=page.viewportSize();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=v.width&&box.y+box.height<=v.height,'completion fits '+label);
      await page.screenshot({path:join(out,label+'-delivery-done.png')});
    }
    await cd.getByRole('button',{name:'Done',exact:true}).click();await pos.bringToFront();await pd.waitFor({state:'hidden'});assert.equal(await pos.getByText('To purchase: $25.00',{exact:true}).count(),0);
    await customer.reload();assert.equal(await cd.count(),0);
    await pos.getByRole('button',{name:'View last gift card · $25.00',exact:true}).click();await pd.getByRole('heading',{name:'Your gift card is ready',exact:true}).waitFor();await pd.getByRole('img',{name:'Scan to receive gift card',exact:true}).waitFor();assert.equal(await cd.count(),0,'staff recovery does not reopen an old card on the customer screen');await pd.getByRole('button',{name:'Done',exact:true}).click();
    // Test the real deadline with a recently completed snapshot, without a minute-long sleep.
    completedAge=57000;await pos.getByRole('button',{name:'Buy a card',exact:true}).click();await pd.getByRole('textbox',{name:'Gift card amount',exact:true}).fill('25');await pd.getByRole('button',{name:'Add $25 to purchase',exact:true}).click();await pd.waitFor({state:'hidden'});await pos.locator('.gc-sale-payment').getByRole('button',{name:'Cash',exact:true}).click();await pos.getByRole('button',{name:'Submit',exact:true}).click();await pd.getByRole('button',{name:'Done',exact:true}).waitFor();await pd.waitFor({state:'hidden'});await cd.waitFor({state:'hidden'});
    completedAge=0;await pos.getByRole('button',{name:'Buy a card',exact:true}).click();await pd.getByRole('textbox',{name:'Gift card amount',exact:true}).fill('25');await pd.getByRole('button',{name:'Add $25 to purchase',exact:true}).click();await pd.waitFor({state:'hidden'});await pos.locator('.gc-sale-payment').getByRole('button',{name:'Cash',exact:true}).click();await pos.getByRole('button',{name:'Submit',exact:true}).click();await pd.getByRole('button',{name:'Done',exact:true}).waitFor();session={...session,collected:true,revision:session.revision+1};await pd.waitFor({state:'hidden'});await cd.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);await writeFile(join(out,'lifecycle-result.json'),JSON.stringify({passed:true,synthetic:true,actualComponents:true,pairedClose:true,completionSurvivesCartReset:true,issuedDesign:true,autoClose:true,collectionCloses:true,nextCustomerClearsCredentials:true,errors,ops},null,2));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
