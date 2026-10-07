"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { loadPortablePanel } from "./load-panel";
import { useEffect, useState, useRef, useMemo, type ReactNode } from "react";

// The server supplies only panels permitted by the current device session.
// Keep them mounted: changing a tab must not discard a cart or await an action.
export function PortablePanels({ panels, children, allowedPaths }: {
  allowedPaths: string[];
  panels: Record<string, ReactNode>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [loaded,setLoaded] = useState<Record<string,ReactNode>>(() => search.size === 0 ? {[pathname]:children} : {});
  const [failure,setFailure] = useState<string|null>(null);
  const [retry,setRetry] = useState(0);
  const requests = useRef(new Map<string,Promise<ReactNode>>());
  const available = useMemo(()=>({...loaded,...panels}),[loaded,panels]);
  const panelRoute = search.size === 0 && allowedPaths.includes(pathname);
  useEffect(()=>{
    if (!panelRoute || failure===pathname || Object.hasOwn(available,pathname)) return;
    let active=true;
    let request=requests.current.get(pathname);
    if (!request) {
      request=loadPortablePanel(pathname);
      requests.current.set(pathname,request);
    }
    void request.then(panel=>{
      if(active){setLoaded(current=>({...current,[pathname]:panel}));setFailure(null);}
    }).catch(()=>{if(active)setFailure(pathname);}).finally(()=>requests.current.delete(pathname));
    return()=>{active=false;};
  },[pathname,panelRoute,available,retry,failure]);

  useEffect(() => {
    function navigate(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
          event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== location.origin || url.search || url.hash ||
          !allowedPaths.includes(url.pathname)) return;
      event.preventDefault();
      // Next integrates native history with usePathname/useSearchParams.
      window.history.pushState(null, "", url.pathname);
    }
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, [allowedPaths]);

  return <>
    {Object.entries(available).map(([path, panel]) => (
      <div className="h-full" hidden={!panelRoute || pathname !== path}
        key={path} data-portable-panel={path}>{panel}</div>
    ))}
    {panelRoute && !Object.hasOwn(available,pathname) ? <div className="p-6" role="status">
      {failure===pathname ? <><p>This view could not load. Your other tabs are still available.</p><button type="button" onClick={()=>{setFailure(null);setRetry(value=>value+1);}}>Try again</button></> : "Loading view…"}
    </div> : null}
    {!panelRoute ? children : null}
  </>;
}
