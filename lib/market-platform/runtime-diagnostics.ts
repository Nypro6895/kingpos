// Never pass request URLs, bodies, headers, credentials or provider errors here.
export function runtimeFailure(operation:"token"|"authorize",code:unknown,requestId:string) {
  const reason=code==="42501"?"denied":code==="PT429"?"rate-limited":code==="PT409"?"conflict":code==="22023"?"invalid-request":"unavailable";
  const id=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)?requestId:undefined;
  console.warn("Market runtime request rejected",{operation:operation==="token"||operation==="authorize"?operation:"runtime",reason,requestId:id});
}
