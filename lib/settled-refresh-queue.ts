// Coalesce independent row saves into one refresh after the whole edit burst.
// A pending save blocks refresh so its inputs cannot be replaced mid-write.
export function createSettledRefreshQueue(refresh:()=>void, delay=900) {
  const pending=new Set<symbol>();
  let dirty=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const cancel=()=>{if(timer)clearTimeout(timer);timer=undefined;};
  const schedule=()=>{
    cancel();
    if(dirty && !pending.size)timer=setTimeout(()=>{timer=undefined;dirty=false;refresh();},delay);
  };
  return {
    begin(id:symbol){pending.add(id);cancel();},
    finish(id:symbol,changed:boolean){pending.delete(id);dirty ||= changed;schedule();},
    remove(id:symbol){pending.delete(id);schedule();},
    dispose(){cancel();pending.clear();dirty=false;},
  };
}
