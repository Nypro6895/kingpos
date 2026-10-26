import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.env.KIOSK_SOURCE_ROOT || process.cwd();
const patch=process.env.KIOSK_PATCH_ROOT || root;
const ts=createRequire(path.join(root,'package.json'))('typescript');
const source=fs.readFileSync(path.join(patch,'app/pos/customer-display/customer-display-client.tsx'),'utf8');
const tree=ts.createSourceFile('display.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions={},callbacks={};let effect;
function walk(n){
 if(ts.isFunctionDeclaration(n)&&n.name)functions[n.name.text]=n.getText(tree);
 if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(tree)==='useCallback')callbacks[n.name.getText(tree)]=n.initializer.arguments[0].getText(tree);
 if(ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.getText(tree).includes('lastSubmittedPhoneRef.current = phoneDigits'))effect=n.arguments[0].getText(tree);
 ts.forEachChild(n,walk);
}walk(tree);
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function harness(){
 const c={exports:{},token:'fixture',phoneInput:'2025550147',phoneDigits:'2025550147',confirmedPhone:'2025550147',liveDraftStatus:'draft',displayMode:'phone',lastSubmittedPhoneRef:{current:'2025550147'},localPreview:{current:null},liveDraftRef:{current:null},isCustomerPending:false,isServicePending:false,
 selectedServiceIds:['synthetic-service'],serviceSelectionState:{visit:{id:'synthetic-visit'}},calls:[],applied:[],customerNameInput:'Avery Demo',markCustomerInteraction(){},notifyWaitingChanged(){},hasMeaningfulReceipt(){return false;}};
 for(const setter of new Set(source.match(/\bset[A-Z]\w+/g)))c[setter]=v=>{const field=setter[3].toLowerCase()+setter.slice(4);c[field]=typeof v==='function'?v(c[field]):v;};
 c.applyCustomerPhoneResult=(...args)=>c.applied.push(args);
 let counter=0;c.getRequestId=()=>`fixture-request-${++counter}`;
 c.submitCustomerDisplayPhone=async input=>{c.calls.push(input);return {ok:true,data:{mode:'check_in',visit:{id:'synthetic-visit'}}};};
 vm.createContext(c);
 vm.runInContext(transpile(fs.readFileSync(path.join(patch,'lib/kiosk-request-guard.ts'),'utf8')),c);
 c.phoneRequestGuard={current:c.exports.createKioskRequestGuard()};c.serviceRequestGuard={current:c.exports.createKioskRequestGuard()};c.phoneEntryEditingRef={current:false};
 for(const name of ['digitsOnly','localPhoneKey','isUsPhoneCandidate','returnToPhoneEntry','submitRequestedServices','createCustomerProfile','confirmCustomer'])vm.runInContext(transpile(functions[name]),c);
 for(const name of ['submitDisplayPhone','submitPhoneLookup','handlePhoneInput','applySnapshot'])vm.runInContext(transpile(`globalThis.${name}=${callbacks[name]}`),c);
 vm.runInContext(transpile(`globalThis.autoPhone=${effect}`),c);
 return c;
}
test('actual Back restores editable phone and suppresses unchanged auto-submit; editing submits once',()=>{
 const c=harness();c.phoneInput='';c.returnToPhoneEntry();
 assert.equal(c.phoneInput,'2025550147');assert.equal(c.confirmedPhone,null);assert.equal(c.isChangingCustomer,true);
 c.submitPhoneLookup=p=>c.calls.push(p);c.autoPhone();assert.equal(c.calls.length,0);
 c.handlePhoneInput('202555014');c.phoneDigits=c.phoneInput;c.autoPhone();assert.equal(c.calls.length,0);
 c.handlePhoneInput('2025550148');c.phoneDigits=c.phoneInput;c.autoPhone();c.autoPhone();
 assert.equal(c.calls.length,1);assert.equal(c.calls[0],'2025550148');
});
test('pending lookup response after Back cannot advance the screen',async()=>{
 const c=harness();let resolve;c.submitCustomerDisplayPhone=()=>new Promise(r=>resolve=r);
 const pending=c.submitPhoneLookup();c.returnToPhoneEntry();
 resolve({ok:true,data:{mode:'check_in',visit:{id:'old-visit'}}});await pending;
 assert.equal(c.applied.length,0);assert.equal(c.isCustomerPending,false);
});
test('polling snapshot with previous customer cannot cancel Back/edit mode',()=>{
 const c=harness();c.versionRef={current:null};c.serverOffsetRef={current:0};
 c.returnToPhoneEntry();
 c.applySnapshot({status:'draft',version:1,server_now:new Date().toISOString(),customer:{id:'previous',phone:'2025550147'}});
 assert.equal(c.isChangingCustomer,true);assert.equal(c.confirmedPhone,null);assert.equal(c.phoneInput,'2025550147');
});
test('editing ignores old response while new request remains pending',async()=>{
 const c=harness();const resolves=[];c.submitCustomerDisplayPhone=()=>new Promise(r=>resolves.push(r));
 const old=c.submitPhoneLookup();c.handlePhoneInput('2025550148');const newer=c.submitPhoneLookup('2025550148');
 resolves[0]({ok:true,data:{mode:'check_in',visit:{id:'old'}}});await old;
 assert.equal(c.applied.length,0);assert.equal(c.isCustomerPending,true);
 resolves[1]({ok:true,data:{mode:'check_in',visit:{id:'new'}}});await newer;assert.equal(c.applied.length,1);
});
test('double-submit is gated, failed transport retries retain ID and canonical payload across +1',async()=>{
 const c=harness();let release;c.submitCustomerDisplayPhone=input=>{c.calls.push(input);return new Promise(r=>release=r);};
 const pending=c.submitPhoneLookup();await c.submitPhoneLookup();assert.equal(c.calls.length,1);
 release({ok:false,error:'offline'});await pending;const first=c.calls[0];
 c.submitCustomerDisplayPhone=async input=>{c.calls.push(input);return {ok:false,error:'offline'};};
 await c.submitPhoneLookup('12025550147');assert.equal(c.calls[1].requestId,first.requestId);assert.equal(c.calls[1].phone,first.phone);
 c.returnToPhoneEntry();await c.submitPhoneLookup('2025550147');assert.equal(c.calls[2].requestId,first.requestId);
});
test('repeated Confirm invokes one save, and Back rejects obsolete save response',async()=>{
 const c=harness();let release;c.saveCustomerDisplayRequestedServices=input=>{c.calls.push(input);return new Promise(r=>release=r);};
 const pending=c.submitRequestedServices();await c.submitRequestedServices();assert.equal(c.calls.length,1);
 c.returnToPhoneEntry();release({ok:true,data:{mode:'check_in',visit:{id:'old'}}});await pending;
 assert.equal(c.checkInState,null);assert.equal(c.isServicePending,false);
});
test('successful Confirm ignores repeated stale handler without another save',async()=>{
 const c=harness();c.saveCustomerDisplayRequestedServices=async input=>{c.calls.push(input);return {ok:true,data:{mode:'check_in',visit:{id:'synthetic-visit'}}};};
 const selection=c.serviceSelectionState;await c.submitRequestedServices();
 c.serviceSelectionState=selection;c.selectedServiceIds=['synthetic-service'];await c.submitRequestedServices();
 assert.equal(c.calls.length,1);assert.equal(c.isServicePending,false);
});
