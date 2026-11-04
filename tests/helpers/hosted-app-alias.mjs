// Playwright routes do not re-match the redirected URLs of an intercepted
// request chain. Our unhosted HTTPS example origin therefore uses a navigation
// relay at the transport boundary only. Actual BFF/Next auth handlers, cookies,
// state, PKCE, code exchange and database authorization remain unchanged.
export async function relayLocalAppResponse(route,target,{origins}){
 const request=route.request(),url=new URL(request.url()),destination=new URL(target);
 if(destination.protocol!=='http:'||destination.hostname!=='127.0.0.1')throw Error('Test relay accepts explicit loopback transport only');
 const response=await fetch(destination,{method:request.method(),headers:request.headers(),redirect:'manual'});
 const headers=Object.fromEntries(response.headers);
 for(const key of ['content-length','content-encoding','transfer-encoding','connection'])delete headers[key];
 const location=response.headers.get('location');
 if(response.status>=300&&response.status<400&&location){
  const next=new URL(location,url);if(!origins.includes(next.origin))throw Error('Redirect escaped the test app/Reylumi origins');
  const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  delete headers.location;headers['content-type']='text/html; charset=utf-8';headers['cache-control']='no-store';headers['referrer-policy']='no-referrer';
  await route.fulfill({status:200,headers,body:`<!doctype html><meta http-equiv="refresh" content="0;url=${escape(next.href)}"><p>Following the verified local test redirect…</p>`});return;
 }
 await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
}
