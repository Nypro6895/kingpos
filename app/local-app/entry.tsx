import { Activity, Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppLocalHelp } from "@/components/app-local-help";
import { LumiLoadingStatus } from "@/components/lumi-loading-status";
import { LegalDocumentPage, LegalHub } from "@/app/legal/legal-components";
import { legalDocuments } from "@/lib/legal-policies";
import { getAppLocalHost, appLocalPath, appLocalRequestId, type AppLocalContext } from "@/lib/app-local-host";
import { resetAppLocalResources, useAppLocalResource } from "@/lib/app-local-resource";
import { getAppLocalCommandScope, setAppLocalCommandScope } from "@/lib/app-local-command-client";
import { getAppLocalPage as getGeneralAppLocalPage } from "@/lib/app-local-page-registry";
import { getAppLocalPersonalPage } from "@/lib/app-local-personal-registry";
import { getAppLocalExplorePage } from "@/lib/app-local-explore-registry";
import { getAppLocalOwnerPage } from "@/lib/app-local-owner-page-registry";
import { getAppLocalBusinessPage } from "@/lib/app-local-business-registry";
import { getAppLocalPublicPage } from "@/lib/app-local-public-registry";
import { getAppLocalDailyPage } from "@/lib/app-local-daily-registry";
import { getAppLocalSecondaryPage, appLocalRouteAlias } from "@/lib/app-local-secondary-registry";
import { getAppLocalPayrollTaxPage } from "@/lib/app-local-payroll-tax-registry";
import { getAppLocalCommercePage } from "@/lib/app-local-commerce-registry";
import { getAppLocalPortablePage } from "@/lib/app-local-portable-registry";
import { getAppLocalDisplayPage } from "@/lib/app-local-display-registry";
import { isAppLocalScopeId, isAppLocalPortableScopeId } from "@/lib/app-local-scope-id";
import { OwnerLocalWorkspace } from "@/app/pos/owner-local-workspace";
import { OwnerLocalPanels } from "@/app/pos/owner-local-panels";
import { OwnerPosClient } from "@/app/pos/owner-pos-client";
import { OwnerPosNavigation } from "@/app/pos/owner-pos-tabs";
import type { OwnerLocalPanelData } from "@/lib/owner-local-workspace";
import { AppLocalNavigationProvider } from "./navigation";
import { AppLocalShell } from "@/components/app-local-shell";
import { ExperienceScopeProvider } from "./scope";
import { installAppLocalHttpClient } from "@/lib/app-local-http-client";
import { acceptExperienceOfflineGrant, clearExperienceSnapshots } from "@/lib/experience-persistent-cache";
import { clearExperienceState } from "@/lib/experience-state";
import { installAppLocalRoleHttpClient } from "@/lib/app-local-role-http-client";
import { installAppLocalPersonalHttpClient } from "@/lib/app-local-personal-http-client";
import { installAppLocalExploreHttpTransport } from "@/lib/app-local-explore-http-client";
import { installAppLocalPublicHttpTransport } from "@/lib/app-local-public-http-client";
import { installAppLocalBusinessHttpClient } from "@/lib/app-local-business-http-client";
import { installAppLocalShellHttpTransport } from "@/lib/app-local-shell-http-client";
import { installAppLocalPortableHttpClient } from "@/lib/app-local-portable-http-client";
import { installAppLocalDisplayHttpClient } from "@/lib/app-local-display-http-client";
import { installAppLocalLinkNavigation } from "@/lib/app-local-link-navigation";
import { APP_LOCAL_REFERENCE_ASSETS } from "@/lib/app-local-reference-content";
import { installAppLocalBrowserCompatibility } from "@/lib/app-local-browser-compat";
import { getExperienceOfflinePath, isExperienceOfflineGrant } from "@/lib/experience-offline-policy";

if (typeof crypto.randomUUID !== "function") Object.defineProperty(crypto, "randomUUID", { value: appLocalRequestId });
installAppLocalBrowserCompatibility();
function alignDeviceGeneration() { const generation = window.__reylumiAppLocalContext?.generation; if (generation && /^[\w-]{16,100}$/.test(generation)) try { localStorage.setItem("reylumi:offline-device-generation:v1", generation); } catch { /* Native reads still use the encrypted native store. */ } }
alignDeviceGeneration();
installAppLocalHttpClient(getAppLocalCommandScope);
installAppLocalRoleHttpClient(getAppLocalCommandScope);
installAppLocalPersonalHttpClient(getAppLocalCommandScope);
installAppLocalExploreHttpTransport();
installAppLocalPublicHttpTransport();
installAppLocalBusinessHttpClient(getAppLocalCommandScope);
installAppLocalShellHttpTransport();
installAppLocalDisplayHttpClient(getAppLocalCommandScope);
installAppLocalPortableHttpClient(getAppLocalCommandScope);
for(const method of ["pushState","replaceState"] as const){const original=history[method];history[method]=function(...args){const result=original.apply(this,args);window.dispatchEvent(new Event("reylumi:app-local-history"));return result;};}
function getAppLocalPage(path:string){return getGeneralAppLocalPage(path)??getAppLocalPersonalPage(path)??getAppLocalExplorePage(path)??getAppLocalOwnerPage(path)??getAppLocalBusinessPage(path)??getAppLocalPublicPage(path)??getAppLocalDailyPage(path)??getAppLocalSecondaryPage(path)??getAppLocalPayrollTaxPage(path)??getAppLocalCommercePage(path)??getAppLocalPortablePage(path)??getAppLocalDisplayPage(path);}
function pageKey(path:string){const id=getAppLocalPage(path)?.id;return id==="explore"||id==="market"||id==="portable"?"family:"+id:path;}

const legalByPath: Record<string, keyof typeof legalDocuments> = { "/privacy": "privacy", "/terms": "terms", "/community": "community", "/business-terms": "business" };
const ownerPaths = new Set(["/pos", "/pos/check-in", "/pos/book", "/pos/ticket", "/pos/report"]);
const publicExperience = { scope: "public", viewerId: null, workspaceId: "public", salonId: null, permissionRevision: "", authenticated: false };
function PublicPage({ path, navigate, experienceScope }: { path: string; navigate: (href: string) => void; experienceScope?: string }) {
  const url = new URL(path, "https://reylumi.com");
  if (url.pathname === "/help" || url.pathname.startsWith("/help/")) return <AppLocalHelp slug={url.pathname.startsWith("/help/") ? decodeURIComponent(url.pathname.slice(6)) : undefined} language={url.searchParams.get("lang") === "en" ? "en" : "vi"} navigate={navigate} experienceScope={experienceScope} />;
  if (url.pathname === "/legal") return <LegalHub />;
  if (legalByPath[url.pathname]) return <LegalDocumentPage document={legalDocuments[legalByPath[url.pathname]]} />;
  return null;
}
function isPublic(path: string) { const pathname = path.split("?")[0]; return pathname === "/help" || pathname.startsWith("/help/") || pathname === "/legal" || pathname in legalByPath; }
function isHelp(path: string) { const pathname = path.split("?")[0]; return pathname === "/help" || pathname.startsWith("/help/"); }
type AuthorityFamily = "account" | "staff.portal" | "staff.workday" | "portable" | "display";
type Admission = { value: AppLocalContext; generation?: string };
/** Mirror the context endpoint's original staff/portable resolution, not a permission rule. */
function authorityFamily(path: string): AuthorityFamily {
  const pathname = path.split("?")[0];
  if (pathname === "/pos/customer-display") return "display";
  const canonical = getExperienceOfflinePath(path, "https://reylumi.com")?.split("?")[0];
  if (canonical === "/staff/workday") return "staff.workday";
  if (canonical === "/staff/my-work" || canonical === "/staff/appointments") return "staff.portal";
  if (canonical && /^\/pos\/portable(?:\/(?:check-in|book|ticket|today|report))?$/.test(canonical)) return "portable";
  return "account";
}
function usable(admission?: Admission): admission is Admission {
  if (!admission) return false;
  const generation = window.__reylumiAppLocalContext?.generation;
  if (admission.generation !== generation) return false;
  const value = admission.value;
  return Boolean(value.grant && isExperienceOfflineGrant(value.grant, { scope: value.context.scope, ...(generation ? { generation } : {}) }))
    || Boolean(!value.offline && navigator.onLine && Date.now() - value.onlineValidatedAt < 30_000);
}
function OwnerPages({ context, path, navigate, active }: { context: AppLocalContext; path: string; navigate: (href: string) => void; active: boolean }) {
  const checkout = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (path.split("?")[0] === "/pos") return;
    for (const dialog of checkout.current?.querySelectorAll<HTMLDialogElement>("dialog.owner-picker-dialog[open]") ?? []) {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      if (dialog.open) dialog.close();
    }
  }, [path]);
  const scope = context.context.scope, salonId = context.context.salonId ?? "", ownerScope = `owner:${salonId}:${context.context.viewerId}`;
  const resource = useAppLocalResource<OwnerLocalPanelData>(scope, "owner.workspace", { query: "" }, { enabled: active });
  const reference = resource.data?.view === "workspace" ? resource.data.props : undefined;
  const ownerTabs: Record<string, "pos" | "ticket" | "book" | "checkIn" | "report"> = { "/pos": "pos", "/pos/ticket": "ticket", "/pos/book": "book", "/pos/check-in": "checkIn", "/pos/report": "report" };
  const activeTab = ownerTabs[path.split("?")[0]] ?? "pos";
  return <OwnerLocalWorkspace scope={scope} salonId={salonId} ownerScope={ownerScope} active={active}>
    <Activity mode={active ? "visible" : "hidden"}><OwnerPosNavigation active={activeTab} syncScope={ownerScope} /></Activity>
    <div ref={checkout} hidden={path.split("?")[0] !== "/pos"}>
      {reference ? <OwnerPosClient scope={ownerScope} salonId={salonId} salonName={reference.salonName} initial={reference} preferences={reference.preferences} snapshotAt={resource.updatedAt} active={active && path.split("?")[0] === "/pos"} showNavigation={false} /> : <section className="p-6" aria-busy={resource.loading || resource.refreshing}><h1 className="text-xl font-semibold">POS</h1>{resource.error ? <><p className="mt-4">Please check your connection and try again.</p><button type="button" className="mt-4 rounded border px-4 py-2" onClick={() => void resource.refresh()}>Try again</button></> : <LumiLoadingStatus />}</section>}
    </div>
    <Activity mode={active ? "visible" : "hidden"}><OwnerLocalPanels scope={scope} salonId={salonId} activeHref={path} navigate={navigate} /></Activity>
  </OwnerLocalWorkspace>;
}
class PageBoundary extends Component<{ children: ReactNode; recover(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <section className="p-6"><h1 className="text-xl font-semibold">Please open this page again</h1><button className="mt-4 rounded border px-4 py-2" onClick={() => { this.setState({ failed: false }); this.props.recover(); }}>Try again</button></section> : this.props.children; }
}
function App() {
  const [path, setPath] = useState(() => appLocalPath(location.pathname === "/index.html" ? "/help" : location.pathname + location.search));
  const [admissions, setAdmissions] = useState<Partial<Record<AuthorityFamily, Admission>>>({}), [error, setError] = useState(false), [visited, setVisited] = useState<string[]>([]);
  const [helpPresentation, setHelpPresentation] = useState<Admission | null>(null);
  const current = useRef(path), admitted = useRef(admissions), contextEpoch = useRef(0), request = useRef<AbortController | null>(null);
  const recoveryAttempts = useRef(new Set<string>());
  useLayoutEffect(() => { current.current = path; }, [path]);
  const accept = useCallback((value: AppLocalContext, requestedPath: string) => {
    if (!value || value.schemaVersion !== 1 || !isAppLocalScopeId(value.context?.scope)) return;
    const family = authorityFamily(requestedPath);
    if (family !== authorityFamily(current.current) || isPublic(current.current)) return;
    if(isAppLocalPortableScopeId(value.context.scope)&&(value.grant?.kind!=="portable"||value.grant.scope!==value.context.scope||value.grant.salonId!==value.context.salonId||value.grant.workspaceId!==value.context.workspaceId))return;
    if (family === "portable" && !isAppLocalPortableScopeId(value.context.scope)) return;
    if (family !== "portable" && family !== "display" && isAppLocalPortableScopeId(value.context.scope)) return;
    if (getAppLocalHost().isNative && value.grant) { alignDeviceGeneration(); void acceptExperienceOfflineGrant(value.grant); }
    const previous = admitted.current[family], all = Object.values(admitted.current), generation = window.__reylumiAppLocalContext?.generation;
    const identityChanged = all.some(item => item && (item.value.context.viewerId !== value.context.viewerId || item.generation !== generation));
    const authorityChanged = previous && (previous.value.context.scope !== value.context.scope || previous.value.context.permissionRevision !== value.context.permissionRevision || previous.value.grant && value.grant && previous.value.grant.grantRevision !== value.grant.grantRevision);
    if (identityChanged || authorityChanged) { resetAppLocalResources(); clearExperienceState(); setVisited([]); admitted.current = {}; }
    admitted.current = { ...admitted.current, [family]: { value, generation } }; setAdmissions(admitted.current);
    setAppLocalCommandScope(usable(admitted.current[family]) ? value.context.scope : undefined); setError(false);
  }, []);
  const verify = useCallback(async (options?: { fresh?: boolean }) => {
    if (isPublic(current.current)) return;
    const requestedPath = current.current, started = ++contextEpoch.current; request.current?.abort(); const controller = new AbortController(); request.current = controller;
    try { const value = await getAppLocalHost().context(requestedPath, { signal: controller.signal, fresh: options?.fresh }); if (!controller.signal.aborted && started === contextEpoch.current) accept(value, requestedPath); }
    catch { if (!controller.signal.aborted && started === contextEpoch.current) setError(true); }
  }, [accept]);
  const transition = useCallback((destination: string) => {
    const previous = current.current;
    if (isHelp(destination)) {
      if (!isHelp(previous)) {
        const outgoing = admitted.current[authorityFamily(previous)];
        setHelpPresentation(!isPublic(previous) && usable(outgoing) && outgoing.value.context.authenticated
          && authorityFamily(previous) !== "portable" && authorityFamily(previous) !== "display" ? outgoing : null);
      }
    } else setHelpPresentation(null);
    if (previous !== destination) { contextEpoch.current++; request.current?.abort(); recoveryAttempts.current.clear(); setError(false); }
    current.current = destination;
    const target = admitted.current[authorityFamily(destination)];
    setAppLocalCommandScope(!isPublic(destination) && usable(target) ? target.value.context.scope : undefined);
    setVisited(paths => [...new Set([...paths, previous, destination])].slice(-16)); setPath(destination);
  }, []);
  const navigate = useCallback((value: string, replace = false) => {
    let destination: string; try { destination = appLocalPath(value); } catch { return; }
    destination=appLocalRouteAlias(destination)??destination;
    if (!isPublic(destination) && !ownerPaths.has(destination.split("?")[0]) && !getAppLocalPage(destination)) { void getAppLocalHost().openOnline(destination); return; }
    // Capture the outgoing page before our history observer sees the new URL.
    transition(destination);
    (replace ? history.replaceState : history.pushState).call(history, {}, "", destination);
  }, [transition]);
  useEffect(()=>installAppLocalLinkNavigation({navigate,isLocalRoute:href=>isPublic(href)||ownerPaths.has(href.split("?")[0])||Boolean(getAppLocalPage(href)),openOnline:path=>getAppLocalHost().openOnline(path),getScope:getAppLocalCommandScope,helpImagePaths:APP_LOCAL_REFERENCE_ASSETS}),[navigate]);
  useEffect(() => {
    const saved = admitted.current[authorityFamily(path)];
    // A recent online admission already verified this family. Commands still
    // authorize on the server; foreground and access failures force rechecking.
    const recent = usable(saved) && !saved.value.offline && Date.now() - saved.value.onlineValidatedAt < 30_000;
    if (!isPublic(path) && !recent) void verify();
  }, [path, verify]);
  useEffect(() => {
    const nav = (event: Event) => { const value = (event as CustomEvent<{ path?: string }>).detail?.path; if (value) navigate(value); };
    const fresh = (event: Event) => { const value = (event as CustomEvent<AppLocalContext & { contextPath?: string }>).detail; if (typeof value?.contextPath === "string") accept(value, value.contextPath); };
    const reset = (event: Event) => {
      contextEpoch.current++; request.current?.abort(); alignDeviceGeneration(); void clearExperienceSnapshots({ rotateGeneration: false }); clearExperienceState(); resetAppLocalResources(); setAppLocalCommandScope(undefined); admitted.current = {}; setAdmissions({}); setHelpPresentation(null); setVisited([]); setError(true);
      const detail = (event as CustomEvent<{ reason?: string; scope?: string }>).detail;
      const key = `${authorityFamily(current.current)}:${detail?.scope ?? ""}`;
      // One fresh authority recovery per user navigation. Context rejection or
      // a second failing read stops at an actionable retry, never a retry loop.
      if (detail?.reason === "resource" && !isPublic(current.current) && !recoveryAttempts.current.has(key)) {
        recoveryAttempts.current.add(key); setError(false); void verify({ fresh: true });
      }
    };
    const resume = () => { void verify({ fresh: true }); };
    let accessCheck: ReturnType<typeof setTimeout> | undefined;
    const revalidateAccess = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (isPublic(current.current) || admitted.current[authorityFamily(current.current)]?.value.context.scope !== scope || accessCheck) return;
      accessCheck = setTimeout(() => { accessCheck = undefined; if (!isPublic(current.current) && admitted.current[authorityFamily(current.current)]?.value.context.scope === scope) void verify({ fresh: true }); }, 50);
    };
    const pop = () => transition(appLocalPath(location.pathname + location.search));
    window.addEventListener("reylumi:app-local-navigate", nav); window.addEventListener("reylumi:app-local-context", fresh); window.addEventListener("reylumi:app-local-reset", reset); window.addEventListener("reylumi:app-local-access-changed", reset); window.addEventListener("popstate", pop);window.addEventListener("reylumi:app-local-history",pop);
    window.addEventListener("online", resume); window.addEventListener("reylumi:foreground", resume);
    window.addEventListener("reylumi:app-local-revalidate-access", revalidateAccess);
    return () => { clearTimeout(accessCheck); window.removeEventListener("reylumi:app-local-revalidate-access", revalidateAccess); window.removeEventListener("reylumi:app-local-navigate", nav); window.removeEventListener("reylumi:app-local-context", fresh); window.removeEventListener("reylumi:app-local-reset", reset); window.removeEventListener("reylumi:app-local-access-changed", reset); window.removeEventListener("popstate", pop);window.removeEventListener("reylumi:app-local-history",pop); window.removeEventListener("online", resume); window.removeEventListener("reylumi:foreground", resume); };
  }, [navigate, accept, verify, transition]);
  const activeAdmission = admissions[authorityFamily(path)], context = !isPublic(path) && usable(activeAdmission) ? activeAdmission.value : null;
  // Help can display the already admitted role chrome, but receives no account
  // context or command scope. A cold public launch never manufactures one.
  const presentationContext = isHelp(path) && usable(helpPresentation ?? undefined) ? helpPresentation!.value : null;
  useEffect(() => {
    if (!context?.grant) return;
    const remaining = context.grant.expiresAt - Date.now();
    const timer = setTimeout(() => { window.dispatchEvent(new Event("reylumi:app-local-access-changed")); void verify({ fresh: true }); }, Math.max(0, Math.min(remaining, 2147483647)));
    return () => clearTimeout(timer);
  }, [context, verify]);
  useEffect(() => {
    if (!presentationContext || !helpPresentation) return;
    const captured = helpPresentation;
    const remaining = (presentationContext.grant?.expiresAt ?? presentationContext.onlineValidatedAt + 30_000) - Date.now();
    // Decorative Help chrome cannot revoke another retained workspace or its
    // draft. Actual authority is checked independently before that page returns.
    const timer = setTimeout(() => setHelpPresentation(previous => previous === captured ? null : previous), Math.max(0, Math.min(remaining, 2147483647)));
    return () => clearTimeout(timer);
  }, [presentationContext, helpPresentation]);
  useLayoutEffect(() => { window.dispatchEvent(new Event("reylumi:screen-ready")); }, [path]);
  const ownerAdmission = admissions.account, ownerContext = ownerAdmission?.value;
  const owner = ownerContext?.grant?.kind === "owner" || Boolean(ownerContext && !ownerContext.offline && ownerContext.access?.ownerWorkspace);
  const windows=new Map<string,string>();for(const href of [...visited,path])if(!isPublic(href)&&getAppLocalPage(href))windows.set(pageKey(href),href);
  const ownerVisited=ownerPaths.has(path.split("?")[0])||visited.some(href=>ownerPaths.has(href.split("?")[0]));
  return <AppLocalNavigationProvider value={{ path, navigate, refresh: () => void verify() }}><ExperienceScopeProvider context={context?.context ?? publicExperience}><AppLocalShell context={context} presentationContext={presentationContext} path={path}>
    <div className="app-local-body" data-app-local-ready="true">
      {isPublic(path) ? <div className="app-local-page"><PublicPage path={path} navigate={navigate} experienceScope={presentationContext?.context.scope} /></div> : null}
      {!isPublic(path) && !context && getAppLocalPage(path)?.requiresContext !== false ? <section className="p-6" aria-busy={!error}>{error ? <><h1 className="text-xl font-semibold">{getAppLocalPage(path)?.title ?? "POS"}</h1><p className="mt-4">Please check your connection and try again.</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void verify()}>Try again</button></> : <LumiLoadingStatus />}</section> : null}
      {context && !owner && ownerPaths.has(path.split("?")[0]) ? <section className="p-6" aria-busy={!error}><h1 className="text-xl font-semibold">{path.startsWith("/pos/check-in") ? "Check In" : "POS"}</h1><p className="mt-4">{error || context.offline ? "Connect to verify access to this workspace." : "Opening your workspace…"}</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void verify()}>Try again</button></section> : null}
        {ownerContext && owner && ownerVisited && ownerContext.context.salonId ? <div className="app-local-page" hidden={!context || !ownerPaths.has(path.split("?")[0])}><ExperienceScopeProvider context={ownerContext.context} guardForms={false}><PageBoundary recover={() => void verify()}><OwnerPages context={ownerContext} path={path} navigate={navigate} active={Boolean(context && ownerPaths.has(path.split("?")[0]))} /></PageBoundary></ExperienceScopeProvider></div> : null}
        {!context && activeAdmission && getAppLocalPage(path)?.requiresContext === false ? (() => { const page = getAppLocalPage(path)!; return <div className="app-local-page"><page.Component context={null} path={path} navigate={navigate} /></div>; })() : null}
        {[...windows].map(([key,href]) => {
          const page = getAppLocalPage(href), admission = admissions[authorityFamily(href)], ownContext = admission?.value ?? null;
          const active = key === pageKey(path) && (usable(admission) || !admission && !page?.requiresContext);
          return page && (ownContext || !page.requiresContext) ? <Activity mode={active ? "visible" : "hidden"} key={key}><div className="app-local-page"><AppLocalNavigationProvider value={{path:href,navigate,refresh:()=>void verify()}}><ExperienceScopeProvider context={ownContext?.context ?? publicExperience} guardForms={false}><PageBoundary recover={() => void verify()}><page.Component context={ownContext} path={href} navigate={navigate} /></PageBoundary></ExperienceScopeProvider></AppLocalNavigationProvider></div></Activity> : null;
        })}
    </div>
  </AppLocalShell></ExperienceScopeProvider></AppLocalNavigationProvider>;
}
createRoot(document.getElementById("app")!).render(<App />);
