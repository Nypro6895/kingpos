"use client";

import { WorkspaceText } from "@/components/workspace-language";
import { usePathname, useSearchParams } from "next/navigation";
import { loadPortablePanel } from "./load-panel";
import { useEffect, useState, useRef, useMemo, type ReactNode } from "react";
import { PosTabPlaceholder } from "@/app/pos/pos-tab-placeholder";
import { PORTABLE_POS_ROUTE_LINKS } from "@/lib/pos-portable-routes";
import { usePortableWorkspaceState } from "./portable-workspace-state";

type PortablePanelsProps = {
  allowedPaths: string[];
  panels: Record<string, ReactNode>;
  children: ReactNode;
};

// The server supplies only panels permitted by the current device session.
// Keep them mounted: changing a tab must not discard a cart or await an action.
export function PortablePanels(props: PortablePanelsProps) {
  const scope = usePortableWorkspaceState()?.scope ?? "";
  // A different device session or permission set must not inherit cached panels.
  const identity = JSON.stringify([scope, [...props.allowedPaths].sort()]);
  return <ScopedPortablePanels key={identity} {...props} />;
}

function ScopedPortablePanels({ panels, children, allowedPaths }: PortablePanelsProps) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [loaded,setLoaded] = useState<Record<string,ReactNode>>(() => search.size === 0 && allowedPaths.includes(pathname) ? {[pathname]:children} : {});
  const [failures,setFailures] = useState<Record<string,boolean>>({});
  const requests = useRef(new Map<string,Promise<ReactNode>>());
  const lifetime = useRef({ active: false, generation: 0 });
  const available = useMemo(()=>({...loaded,...panels}),[loaded,panels]);
  const panelRoute = search.size === 0 && allowedPaths.includes(pathname);
  const failure = failures[pathname] === true;
  const tab = PORTABLE_POS_ROUTE_LINKS.find(link => link.href === pathname)?.id;
  useEffect(() => {
    const state = lifetime.current;
    const pending = requests.current;
    state.active = true;
    state.generation += 1;
    return () => { state.active = false; state.generation += 1; pending.clear(); };
  }, []);

  useEffect(()=>{
    if (!panelRoute || failure || Object.hasOwn(available,pathname) || requests.current.has(pathname)) return;
    const state = lifetime.current;
    const generation = state.generation;
    const current = () => state.active && state.generation === generation;
    const pending = requests.current;
    const request = Promise.resolve().then(() => current() ? loadPortablePanel(pathname) : null);
    pending.set(pathname,request);
    void request.then(panel=>{
      // A local tab switch hides its DOM, but the authorized read stays useful.
      if(current())setLoaded(loaded=>({...loaded,[pathname]:panel}));
    }).catch(()=>{if(current())setFailures(failures=>({...failures,[pathname]:true}));})
      .finally(()=>{if(pending.get(pathname)===request)pending.delete(pathname);});
  },[pathname,panelRoute,available,failure]);

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
    {Object.entries(available).filter(([path]) => allowedPaths.includes(path)).map(([path, panel]) => (
      <div className="h-full" hidden={!panelRoute || pathname !== path}
        key={path} data-portable-panel={path}>{panel}</div>
    ))}
    {panelRoute && !Object.hasOwn(available,pathname) ? <div className="h-full" role="status">
      {failure ? <div className="p-6"><p><WorkspaceText text="This view could not load. Your other tabs are still available." /></p><button type="button" onClick={()=>{setFailures(current=>({...current,[pathname]:false}));}}><WorkspaceText text="Try again" /></button></div> : tab ? <PosTabPlaceholder tab={tab} /> : null}
    </div> : null}
    {!panelRoute ? children : null}
  </>;
}
