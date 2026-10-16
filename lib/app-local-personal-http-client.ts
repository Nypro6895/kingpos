"use client";
import { getAppLocalHost } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";
export function installAppLocalPersonalHttpClient(scope:()=>string|undefined){
  if(typeof window==="undefined"||!getAppLocalHost().isNative)return()=>{};
  const original=window.fetch;
  const bridged:typeof fetch=async(input,init)=>{
    const request=input instanceof Request?input:undefined,value=request?.url??String(input),base=new URL(location.href);let url:URL;
    try{url=new URL(value,base);}catch{return original(input,init);}
    if(url.pathname!=="/api/notifications"||url.hash||url.username||url.password||!(url.origin==="https://reylumi.com"||url.protocol===base.protocol&&url.hostname===base.hostname&&url.port===base.port))return original(input,init);
    const identity=scope();if(!identity)throw new Error("Connect to verify your account.");
    const method=(init?.method??request?.method??"GET").toUpperCase(),host=getAppLocalHost(),signal=init?.signal??request?.signal;
    if(signal?.aborted)throw signal.reason;
    let result:AppLocalHttpResponse;
    if(method==="GET"){
      const allowed=new Set(["filter","limit","before","id"]);if([...url.searchParams].some(([key,value])=>!allowed.has(key)||value.length>512||url.searchParams.getAll(key).length>1))throw new Error("Invalid notification filters.");
      const response=await host.read<AppLocalHttpResponse>("http.notifications.feed",Object.fromEntries(url.searchParams),{scope:identity,signal:signal??undefined});
      if(!response.data)throw new Error("Could not load notifications.");result=response.data;
    }else if(method==="POST"&&!url.search){
      const text=typeof init?.body==="string"?init.body:request?await request.clone().text():"";if(text.length>16384)throw new Error("Invalid notifications.");
      const value=JSON.parse(text);if(signal?.aborted)throw signal.reason;
      // Marking an item read is never placed in a financial/offline retry queue.
      result=await host.command<AppLocalHttpResponse>("http.notifications.viewed",{input:value},{scope:identity});
    }else return original(input,init);
    if(identity!==scope())throw new Error("Your account has changed.");
    return new Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,headers:result.headers});
  };
  window.fetch=bridged;return()=>{if(window.fetch===bridged)window.fetch=original;};
}
