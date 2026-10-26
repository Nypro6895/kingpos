"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { OwnerPosTabs } from "./owner-pos-tabs";
import { PosTabPlaceholder, type PosWorkspaceTab } from "./pos-tab-placeholder";
import { hasPreparedExperiencePath } from "@/lib/experience-offline-client";
import { WorkspaceText } from "@/components/workspace-language";
import { OwnerLocalWorkspace } from "./owner-local-workspace";
import { ownerLocalHref } from "@/lib/owner-local-workspace";

function workspaceHref(href: string) {
  return href.replace(/^\/pos-tickets(?=\/|\?|#|$)/, "/pos/ticket")
    .replace(/^\/bookings(?=\?|#|$)/, "/pos/book")
    .replace(/^\/reports(?=\?|#|$)/, "/pos/report");
}

function workspaceTab(path: string): PosWorkspaceTab | null {
  if (path === "/pos") return "pos";
  if (path.startsWith("/pos/ticket")) return "ticket";
  if (path === "/pos/book") return "book";
  if (path === "/pos/check-in") return "checkIn";
  if (path === "/pos/report") return "report";
  return null;
}

type Props = { checkout: ReactNode; children: ReactNode; localPanels?: ReactNode; salonName?: string; owner?: { scope: string; ownerScope: string; salonId: string } };
const locationEvent = "reylumi:owner-location";
function subscribeLocation(changed: () => void) { window.addEventListener("popstate", changed); window.addEventListener(locationEvent, changed); return () => { window.removeEventListener("popstate", changed); window.removeEventListener(locationEvent, changed); }; }
export function OwnerWorkspaceFrame(props: Props) {
  return props.owner ? <OwnerLocalWorkspace key={props.owner.scope + props.owner.ownerScope} {...props.owner}><WorkspaceFrame {...props} /></OwnerLocalWorkspace> : <WorkspaceFrame {...props} />;
}
function WorkspaceFrame({ checkout, children, owner, localPanels }: Props) {
  const path = usePathname();
  const router = useRouter();
  const [intent, setIntent] = useState<{ from: string; target: string } | null>(null);
  const navigation = useRef(0);
  const [offlineMessage, setOfflineMessage] = useState(false);
  const localHref = useSyncExternalStore(subscribeLocation, () => location.pathname + location.search, () => null);
  // Clear old intent before Back can revisit the route where it was created.
  if (intent && intent.from !== path) setIntent(null);
  const destination = intent?.from === path ? intent.target : owner && localHref && ownerLocalHref(path) ? localHref.split("?")[0] : path;
  const active = workspaceTab(destination) ?? "pos";
  const pending = !!intent && intent.from === path && intent.target !== path;

  useEffect(() => { window.dispatchEvent(new Event("resize")); }, [destination]);
  // A late device-cache answer no longer owns navigation after a route commit,
  // Activity disconnect or departure from this workspace.
  useLayoutEffect(() => () => { navigation.current++; }, [path]);
  useEffect(() => {
    const clear = () => { navigation.current++; setIntent(null); setOfflineMessage(false); };
    window.addEventListener("popstate", clear);
    window.addEventListener("online", clear);
    return () => { window.removeEventListener("popstate", clear); window.removeEventListener("online", clear); };
  }, []);

  async function navigate(target: string) {
    const sequence = ++navigation.current;
    const next = new URL(target, location.href);
    setOfflineMessage(false);
    const local = owner && ownerLocalHref(next.pathname + next.search);
    if (local) {
      setIntent(null);
      if (next.pathname + next.search + next.hash !== location.pathname + location.search + location.hash) window.history.pushState(null, "", local + next.hash);
      window.dispatchEvent(new Event(locationEvent)); return;
    }
    setIntent(workspaceTab(next.pathname) && next.pathname !== path
      ? { from: path, target: next.pathname } : null);
    if (!navigator.onLine) {
      if (next.pathname + next.search === location.pathname + location.search) return;
      // Next's RSC transport needs the server. A prepared document already has
      // every required chunk and restores the same durable checkout draft.
      const available = await hasPreparedExperiencePath(next.pathname + next.search).catch(() => false);
      if (sequence !== navigation.current) return;
      if (available) { window.location.assign(next.href); return; }
      setIntent(null); setOfflineMessage(true); return;
    }
    // Push even for the current POS to supersede an older in-flight tab request.
    router.push(target);
  }

  return <div data-owner-workspace onClickCapture={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target || link.hasAttribute("download") || link.closest("[data-owner-more-popover]")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    const original = url.pathname + url.search + url.hash;
    const target = workspaceHref(original);
    const isWorkspaceTab = link.hasAttribute("data-owner-tab") && workspaceTab(url.pathname);
    if (target !== original || isWorkspaceTab || owner && ownerLocalHref(target)) {
      event.preventDefault(); event.stopPropagation(); void navigate(target);
    }
  }} onSubmitCapture={event => {
    const form = event.target as HTMLFormElement;
    if (form.method.toLowerCase() !== "get") return;
    const url = new URL(form.action, location.href);
    if (url.origin !== location.origin) return;
    const target = workspaceHref(url.pathname);
    if (target !== url.pathname || owner && ownerLocalHref(target)) {
      event.preventDefault(); event.stopPropagation();
      const params = new URLSearchParams();
      new FormData(form).forEach((value, key) => { if (typeof value === "string") params.append(key, value); });
      void navigate(target + "?" + params);
    }
  }}>
    {offlineMessage ? <p role="status" className="px-4 py-3 text-sm text-zinc-600"><WorkspaceText text="Connect to open this view. Your current ticket has been kept." /></p> : null}
    {/* CSS hiding keeps checkout, its single-writer lock and durable draft ID. */}
    <div hidden={active !== "pos"}>{checkout}</div>
    <section className="owner-workspace-panel" hidden={active === "pos"} style={active === "pos" ? { display: "none" } : undefined}>
      <OwnerPosTabs active={active} />
      <div className="owner-workspace-content">
        {owner && localHref ? localPanels : null}
        <div hidden={pending || Boolean(owner && localHref && ownerLocalHref(localHref))}>{children}</div>
        {pending ? <div data-owner-tab-pending={active}><PosTabPlaceholder tab={active} /></div> : null}
      </div>
    </section>
  </div>;
}
