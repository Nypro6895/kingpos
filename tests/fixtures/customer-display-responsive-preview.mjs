import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

// Render the real presentation components with sample data. Action/network
// imports fail closed; this preview cannot write customer or checkout data.
export async function customerDisplayResponsivePreview() {
  const root=process.cwd();
  const file=path.join(root,'app/pos/customer-display/customer-display-client.tsx');
  const current=fs.readFileSync(file,'utf8');
  const beforeFile=path.join(root,'artifacts/customer-display-small-window-20261026/before/app/pos/customer-display/customer-display-client.tsx');
  const sources={current};
  if(fs.existsSync(beforeFile)) sources.before=fs.readFileSync(beforeFile,'utf8');
  const exports=['PhoneEntryPanel','TipPanel','ProfileCreationPanel','CheckoutShell','CheckInShell'];
  const bundles={};
  for(const [version,source] of Object.entries(sources)) {
    const imports=new Map();
    for(const node of ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).statements) {
      if(!ts.isImportDeclaration(node)||!node.importClause?.namedBindings||!ts.isNamedImports(node.importClause.namedBindings))continue;
      imports.set(node.moduleSpecifier.text,node.importClause.namedBindings.elements.filter(n=>!n.isTypeOnly).map(n=>n.propertyName?.text??n.name.text));
    }
    const result=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},
      stdin:{resolveDir:root,loader:'tsx',contents:`
        import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
        import {${exports.join(',')}} from 'display-components';
        import {CustomerIdentityChoices} from './components/customer-identity-choices';
        const q=new URLSearchParams(location.search), mode=q.get('mode')||'phone';
        const settings={appDownloadUrl:'',customerShowSalonName:true,customerShowServiceName:true,customerShowStaffName:true,customerShowReceiptStatus:true,customerShowCustomerName:true,salonName:'King Nails Spa LLC',salonLogoUrl:null,tipSuggestions:[15,18,20]};
        const count=q.has('many')?20:1;
        const draft={id:'fixture',status:'draft',total:45,subtotal:45,tax:0,tip:0,discount:0,total_before_tip:45,staff_lines:Array.from({length:count},(_,i)=>({id:'line-'+i,label:i?'Pedicure and nail art with a long service name':'Full Set',staffName:'Staff Ny',amount:45,amountParts:[45]}))};
        window.previewRequests=[];
        function Fixture(){const[phone,setPhone]=useState(''),[custom,setCustom]=useState(''),[customMode,setCustomMode]=useState(mode==='custom'),[name,setName]=useState(''),[result,setResult]=useState('');
          const phoneProps={customerResults:q.has('results')?[{id:'a',name:'Alex',phone:'5555550123'},{id:'b',name:'Sam',phone:'5555550123'}]:[],customerStatus:q.has('results')?'Choose your profile':null,disabled:false,isCustomerPending:false,isSearching:false,onConfirmCustomer:c=>setResult(c.name),onPhoneInput:setPhone,onSkipToTip:()=>setResult('tip'),onSubmitPhone:()=>setResult(phone),phoneInput:phone,showTipShortcut:!q.has('checkin')};
          let panel=mode==='tip'||mode==='custom'?<TipPanel confirmedPhone="5555550123" customTipInput={custom} customTipMode={customMode} identityLabel="Alex Nguyen" isTipPending={false} liveDraft={draft} onChangeCustomer={()=>{}} onConfirmTip={amount=>{window.previewRequests.push({amount});setResult('Tip '+amount)}} onCustomTipInput={setCustom} onSetCustomTipMode={setCustomMode} tipOptions={[{percentage:15,amount:6.75},{percentage:18,amount:8.1},{percentage:20,amount:9}]} />:mode==='profile'?<><CustomerIdentityChoices candidates={[{id:'a',label:'Alex Nguyen',phoneHint:'***-***-0123',reason:'Same phone'},{id:'b',label:'Sam Nguyen',phoneHint:'***-***-0123',reason:'Same phone'}]} onChoose={x=>setResult(x??'new')}/><ProfileCreationPanel customerStatus={null} disabled={false} isPending={false} nameInput={name} onBack={()=>{}} onNameInput={setName} onSubmit={()=>setResult(name)} phone="5555550123"/></>:<PhoneEntryPanel {...phoneProps}/>;
          const error=q.has('error')?'Connection interrupted. Please try again.':null;
          return <div className="customer-display-kiosk-surface relative h-dvh w-dvw overflow-hidden text-zinc-950"><div className="customer-display-auto-scale h-full w-full">{q.has('checkin')?<CheckInShell backgroundImageUrl="" error={error} isFullscreen={false} onFullscreen={()=>{}} settings={settings}>{panel}</CheckInShell>:<CheckoutShell backgroundImageUrl="" connectionState="connected" displayMode={mode==='tip'||mode==='custom'?'tip':mode==='profile'?'profile':'phone'} error={error} identityLabel="Welcome to King Nails Spa LLC" liveDraft={draft} settings={settings}>{panel}</CheckoutShell>}</div><output className="sr-only" aria-label="Preview result">{result}</output></div>;
        }createRoot(document.getElementById('root')).render(<Fixture/>);`},
      plugins:[{name:'isolated-display',setup(b){
        b.onResolve({filter:/^display-components$/},()=>({path:'display-components',namespace:'display'}));
        b.onLoad({filter:/.*/,namespace:'display'},()=>({contents:source+'\nexport {'+exports.join(',')+'};',loader:'tsx',resolveDir:path.dirname(file)}));
        b.onResolve({filter:/\.css$/},()=>({path:'empty-css',namespace:'mock'}));
        b.onResolve({filter:/^@\//},a=>({path:a.path,namespace:'mock'}));
        b.onResolve({filter:/^\.\/checkin-receipt-panel$/},a=>({path:a.path,namespace:'mock'}));
        b.onLoad({filter:/.*/,namespace:'mock'},a=>{
          if(a.path==='empty-css')return{contents:''};
          if(a.path==='@/components/workspace-language')return{loader:'tsx',resolveDir:root,contents:`export const useWorkspaceTranslation=()=>s=>s;export const WorkspaceText=({text})=><>{text.replace(/&apos;/g,"'").replace(/&middot;/g,'·').replace(/&times;/g,'×')}</>;`};
          return{contents:(imports.get(a.path)??[]).map(n=>n.startsWith('DEFAULT_')?'export const '+n+'="";':'export const '+n+'=()=>{throw Error("Unexpected live boundary: '+n+'");};').join('\n')};
        });
      }}]});
    bundles[version]=result.outputFiles[0].text;
  }
  const globalCss=fs.readFileSync(path.join(root,'app/globals.css'),'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./pos/customer-display/customer-display-client.tsx";\n@source "../components/customer-identity-choices.tsx";');
  const css=await postcss([tailwind()]).process(globalCss,{from:path.join(root,'app/globals.css')});
  const responsive=fs.readFileSync(path.join(root,'app/pos/customer-display/customer-display-responsive.css'),'utf8');
  return createServer((req,res)=>{
    const q=new URL(req.url,'http://localhost');
    if(q.searchParams.has('before')&&!bundles.before){res.statusCode=404;return res.end('Pre-change baseline is unavailable; no comparison can be claimed.');}
    if(q.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundles[q.searchParams.has('before')?'before':'current']);}
    if(q.pathname.startsWith('/brand/')){const asset=path.join(root,'public',q.pathname);if(fs.existsSync(asset)){res.setHeader('Content-Type',q.pathname.endsWith('.svg')?'image/svg+xml':'image/png');return res.end(fs.readFileSync(asset));}}
    if(q.pathname!=='/'){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css.css+(q.searchParams.has('before')?'':responsive)+'</style></head><body><div id="root"></div><script src="/bundle.js'+(q.searchParams.has('before')?'?before':'')+'"></script></body></html>');
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  const server=await customerDisplayResponsivePreview();
  server.listen(3181,'127.0.0.1',()=>console.log('Isolated real-component preview: http://127.0.0.1:3181'));
}
