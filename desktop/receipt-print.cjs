'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateReceiptPrintJob(job) {
  if(!job||job.version!==1||!UUID.test(job.jobId)||!['receipt','provisional','test'].includes(job.kind)||!['58mm','80mm','a4'].includes(job.paper)||typeof job.title!=='string'||!job.title.trim()||job.title.length>120||/[\u0000-\u001f]/.test(job.title)||typeof job.html!=='string'||Buffer.byteLength(job.html,'utf8')>1024*1024||!job.html.includes('data-reylumi-receipt-document="1"')||!job.html.includes("default-src 'none'")||/<\s*(script|iframe|object|embed|link|base|form)\b/i.test(job.html)||/<[^>]+\son[a-z]+\s*=/i.test(job.html)||/<img\b[^>]+src\s*=\s*["'](?!data:image\/(?:png|jpeg);base64,)/i.test(job.html))throw Error('Invalid receipt print job.');
  if(job.kind==='receipt'&&!UUID.test(job.receiptId))throw Error('A saved receipt identity is required.');
  if(job.kind==='provisional'&&(!UUID.test(job.operationId)||typeof job.scope!=='string'||!job.scope.split(':').every(p=>UUID.test(p))||job.scope.split(':').length!==2||job.receiptId))throw Error('A pending local operation identity is required.');
  return job;
}
function provisionalPrintAllowed(job,offlineShell,vault) {
  if(job.kind!=='provisional')return true;
  if(!offlineShell.printReadiness(job.scope).ready)return false;
  const op=vault.list(job.scope).find(row=>row.id===job.operationId),key=op?.payload?.localDraftKey,snapshot=op?.payload?.printSnapshot;
  return op?.kind==='receipt'&&op.state==='pending'&&!op.rejected&&typeof key==='string'&&key.startsWith('kingpos:portable-draft:v1:')&&snapshot?.version===1&&snapshot.completion==='submitted-on-device'&&snapshot.paymentState==='awaiting-server-validation'&&vault.checkpoint(job.scope,key)>=Date.parse(op.occurredAt);
}
function createReceiptPrinter({BrowserWindow,session,offlineShell,vault}) {
  let current=null;const seen=new Set();
  const cancel=()=>{current?.finish({jobId:current.job.jobId,status:'cancelled'});};
  const print=async(raw)=>{
    const job=validateReceiptPrintJob(raw);
    if(current)throw Error('The printer dialog is already open.');
    if(seen.has(job.jobId))throw Error('This print request was already handled. Choose Print again for a new request.');
    if(!provisionalPrintAllowed(job,offlineShell,vault))throw Error('Reconnect and unlock POS before printing this local ticket.');
    const partition=session.fromPartition('receipt-print-'+job.jobId);
    partition.setPermissionRequestHandler((_wc,_permission,reply)=>reply(false));
    partition.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','file://*/*']},(_request,reply)=>reply({cancel:true}));
    const window=new BrowserWindow({show:false,webPreferences:{session:partition,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,javascript:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    const epoch=offlineShell.epoch;
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=result=>{if(done)return;done=true;current=null;if(!window.isDestroyed())window.destroy();resolve(result);};
      current={job,finish};window.on('closed',()=>finish({jobId:job.jobId,status:'cancelled'}));
      window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(job.html)).then(()=>{
        if(done)return;
        if(epoch!==offlineShell.epoch||!provisionalPrintAllowed(job,offlineShell,vault)){finish({jobId:job.jobId,status:'failed',error:'The POS session changed. Reopen the ticket before printing.'});return;}
        if(seen.size>=256)seen.clear();seen.add(job.jobId);
        const pageSize=job.paper==='a4'?'A4':{width:job.paper==='58mm'?58000:80000,height:297000};
        window.webContents.print({silent:false,printBackground:true,color:false,margins:{marginType:'none'},pageSize},(ok,reason)=>finish({jobId:job.jobId,status:ok?'submitted':/cancel/i.test(reason||'')?'cancelled':'failed',...(!ok&&!/cancel/i.test(reason||'')?{error:'System printing failed. Please try again.'}:{})}));
      }).catch(()=>{if(!done){done=true;current=null;if(!window.isDestroyed())window.destroy();reject(Error('Receipt document could not open.'));}});
    });
  };
  return {print,cancel};
}
module.exports={validateReceiptPrintJob,provisionalPrintAllowed,createReceiptPrinter};
