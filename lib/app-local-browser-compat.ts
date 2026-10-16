/** Public API fallbacks for the application's existing iOS 16 minimum. */
export function installAppLocalBrowserCompatibility(){
  if(!("size" in URLSearchParams.prototype))Object.defineProperty(URLSearchParams.prototype,"size",{get(){return Array.from((this as URLSearchParams).entries()).length;}});
  if(typeof AbortSignal.timeout!=="function")Object.defineProperty(AbortSignal,"timeout",{value:(milliseconds:number)=>{
    if(!Number.isSafeInteger(milliseconds)||milliseconds<0)throw new RangeError("Invalid timeout");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException("The operation timed out","TimeoutError")),Math.min(milliseconds,2147483647));
    controller.signal.addEventListener("abort",()=>clearTimeout(timer),{once:true});return controller.signal;
  }});
  if(typeof AbortSignal.any!=="function")Object.defineProperty(AbortSignal,"any",{value:(signals:AbortSignal[])=>{
    const controller=new AbortController(),subscribers=new Map<AbortSignal,()=>void>();
    const dispose=()=>{for(const[signal,listener]of subscribers)signal.removeEventListener("abort",listener);subscribers.clear();};
    for(const signal of signals){if(signal.aborted){controller.abort(signal.reason);dispose();break;}const abort=()=>{controller.abort(signal.reason);dispose();};subscribers.set(signal,abort);signal.addEventListener("abort",abort,{once:true});}
    return controller.signal;
  }});
  if(typeof Response.json!=="function")Object.defineProperty(Response,"json",{value:(data:unknown,init:ResponseInit={})=>{const headers=new Headers(init.headers);if(!headers.has("Content-Type"))headers.set("Content-Type","application/json");return new Response(JSON.stringify(data),{...init,headers});}});
}
