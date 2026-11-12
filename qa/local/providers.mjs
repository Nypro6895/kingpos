import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {runtime,assertMarker,writeJson} from './common.mjs';
assertMarker();
const tokenFile=path.join(runtime,'provider-token');
if(!fs.existsSync(tokenFile))fs.writeFileSync(tokenFile,crypto.randomBytes(32).toString('hex'));
const token=fs.readFileSync(tokenFile,'utf8');
const stateFile=path.join(runtime,'providers.json');
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{sessions:{},intents:{},emails:[],events:[]};
const save=()=>writeJson('providers.json',state);
const id=prefix=>prefix+'_qa_'+crypto.randomUUID().replaceAll('-','');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:3118');
 const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(url.pathname==='/health')return reply({qa:true,mode:'local-simulation',realMoney:false});
 if(url.pathname==='/outbox'){
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
  return res.end('<title>Reylumi QA outbox</title><h1>QA ONLY — captured locally, not sent</h1><pre>'+escape(JSON.stringify({emails:state.emails,events:state.events},null,2))+'</pre>');
 }
 if(req.headers['x-qa-token']!==token)return reply({error:'Local QA control token required'},403);
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024*1024)throw Error('Request too large');}
  if(url.pathname.startsWith('/checkout/')){
   const [, ,sessionId,operation]=url.pathname.split('/');const session=state.sessions[sessionId];
   if(!session)return reply({error:'Unknown local session'},404);
   if(req.method==='POST'&&operation==='pay'){
    session.status='complete';session.payment_status='paid';
    const intent={id:id('pi'),object:'payment_intent',status:'succeeded',currency:session.currency,amount:session.amount_total,amount_received:session.amount_total,metadata:session.metadata,livemode:false,latest_charge:{id:id('ch'),amount_refunded:0,paid:true}};
    state.intents[intent.id]=intent;session.payment_intent=intent;
    state.events.push({kind:'simulated-payment',session:sessionId,amount:session.amount_total,at:new Date().toISOString()});save();
   }
   return reply(session);
  }
  if(url.pathname==='/resend/emails'&&req.method==='POST'){
   const message=JSON.parse(raw);const receipt=id('email');state.emails.push({id:receipt,...message,qa:true,capturedAt:new Date().toISOString()});save();return reply({id:receipt});
  }
  if(!url.pathname.startsWith('/stripe/'))return reply({error:'Unsupported QA provider'},404);
  const endpoint=url.pathname.slice('/stripe/'.length),form=new URLSearchParams(raw);
  if(endpoint.startsWith('accounts/'))return reply({id:endpoint.split('/')[1],object:'account',charges_enabled:true,payouts_enabled:true,details_submitted:true,livemode:false});
  if(endpoint==='checkout/sessions'&&req.method==='POST'){
   const sessionId=id('cs_test'),metadata={};for(const [key,value]of form)if(/^metadata\[/.test(key))metadata[key.slice(9,-1)]=value;
   const session={id:sessionId,object:'checkout.session',url:'https://checkout.stripe.com/qa/'+sessionId,mode:form.get('mode')||'payment',currency:form.get('line_items[0][price_data][currency]')||'usd',amount_total:Number(form.get('line_items[0][price_data][unit_amount]')||0)*Number(form.get('line_items[0][quantity]')||1),status:'open',payment_status:'unpaid',livemode:false,metadata,success_url:form.get('success_url'),cancel_url:form.get('cancel_url'),customer:form.get('customer')||id('cus'),payment_intent:null};
   state.sessions[sessionId]=session;save();return reply(session);
  }
  if(endpoint.startsWith('checkout/sessions/')){const session=state.sessions[endpoint.split('/')[2]];return reply(session||{error:'Unknown session'},session?200:404);}
  if(endpoint.startsWith('payment_intents/')){const intent=state.intents[endpoint.split('/')[1]];return reply(intent||{error:'Unknown intent'},intent?200:404);}
  if(endpoint==='customers'&&req.method==='POST')return reply({id:id('cus'),object:'customer',livemode:false});
  if(endpoint==='payment_methods')return reply({object:'list',data:[]});
  if(endpoint==='refunds'&&req.method==='POST'){
   const intent=state.intents[form.get('payment_intent')];if(!intent)return reply({error:'Unknown payment'},404);
   const amount=Number(form.get('amount')||intent.amount_received);intent.latest_charge.amount_refunded+=amount;save();return reply({id:id('re'),status:'succeeded',amount,payment_intent:intent.id,livemode:false});
  }
  return reply({error:'Unsupported local provider operation; no external fallback'},422);
 }catch(error){return reply({error:error.message},400);}
});
server.listen(3118,'127.0.0.1',()=>{writeJson('provider-process.json',{pid:process.pid,root:runtime,startedAt:new Date().toISOString()});console.log('QA providers: http://127.0.0.1:3118/outbox (simulation only; no external delivery)');});
