(() => {
  if (window.top !== window || !window.webkit?.messageHandlers?.reylumi || window.__reylumiReceiptPrint) return;
  const handler = window.webkit.messageHandlers.reylumi, pending = new Map();
  window.__reylumiReceiptPrintResult = result => {
    const item = pending.get(result?.jobId);
    if (!item || !['presented','submitted','cancelled','failed'].includes(result.status)) return;
    clearTimeout(item.timer); pending.delete(result.jobId);
    item.resolve({jobId:result.jobId,status:result.status,...(typeof result.error==='string'?{error:result.error.slice(0,240)}:{})});
  };
  Object.defineProperty(window, '__reylumiReceiptPrint', {value:Object.freeze({version:1,print(job){
    if (!job || job.version!==1 || typeof job.jobId!=='string' || typeof job.html!=='string' || new TextEncoder().encode(job.html).byteLength>1048576) return Promise.reject(new Error('Invalid receipt print job.'));
    if(pending.size) return Promise.reject(new Error('The print dialog is already opening.'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(job.jobId);reject(new Error('The print dialog did not open. Please try again.'));},30000);
      pending.set(job.jobId,{resolve,reject,timer});
      try{handler.postMessage({action:'print-receipt',job});}catch{clearTimeout(timer);pending.delete(job.jobId);reject(new Error('Receipt printing is unavailable.'));}
    });
  }})});
  window.addEventListener('pagehide',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Receipt printing cancelled because the page changed.'));}pending.clear();});
  for(const event of ['kingpos:portable-lock','kingpos:native-portable-lock','reylumi:app-local-reset']) window.addEventListener(event,()=>handler.postMessage({action:'cancel-receipt-print'}));
})();
