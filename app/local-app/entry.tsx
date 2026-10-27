import { Activity, Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppLocalHelp } from "@/components/app-local-help";
import { LumiLoadingStatus } from "@/components/lumi-loading-status";
import { LegalDocumentPage, LegalHub } from "@/app/legal/legal-components";
import { legalDocuments } from "@/lib/legal-policies";
import { getAppLocalHost, appLocalPath, appLocalRequestId, type AppLocalContext } from "@/lib/app-local-host";
import { resetAppLocalResources, useAppLocalResource, rememberAppLocalRoleResources, reconcileAppLocalRoleResources, clearAppLocalRoleResources, invalidateAppLocalRoleResources } from "@/lib/app-local-resource";
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
import { appLocalAdmissionError, appLocalContextFailureReason, classifyAppLocalContextFailure, isAppLocalContextCancellation, runAppLocalContextRead, type AppLocalContextFailure, type AppLocalContextReason } from "@/lib/app-local-context-recovery";
import { appLocalPageAdmissionReason, canAdmitAppLocalPage } from "@/lib/app-local-page-admission";
import { installExperienceTraceLifecycle, nextExperienceTraceOperation, recordExperienceTrace, type ExperienceTraceTrigger } from "@/lib/experience-trace";
import { appLocalReadTraceFields, captureAppLocalReadTrace } from "@/lib/read-request-trace-protocol";
import { useAppLocalPrefetch } from "@/lib/app-local-prefetch";
import { readPriorityScheduler } from "@/lib/read-priority-scheduler";

installExperienceTraceLifecycle();
recordExperienceTrace("boot.start", { source: "app-local", durationMs: typeof window.__reylumiBundleParseStartedAt === "number" ? performance.now() - window.__reylumiBundleParseStartedAt : undefined });

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
// Cached route DOM belongs to its own accepted identity. Clearing resource
// caches alone cannot clear an uncontrolled private draft on the current path.
// Lease renewal timestamps deliberately do not remount an unchanged identity.
function privateAdmissionKey(admission?: Admission) {
  return JSON.stringify([admission?.generation, admission?.value.context.viewerId, admission?.value.context.scope]);
}
type ContextCheck = { path: string; controller: AbortController; requireFresh: boolean; promise?: Promise<void> };
type WorkspaceRecovery = { viewerId: string; generation: string; workspaceId?: string };
type WorkspaceGesture = WorkspaceRecovery & { scope: string };
type WorkspaceResolution = { controller: AbortController; promise?: Promise<void> };
type PageRecovery = WorkspaceRecovery & { path: string; target?: string };
type NativeResetPending = { generation: string; scopeEpoch: number; path: string; contextEpoch: number; timer?: ReturnType<typeof setTimeout> };
const contextFailureMessages: Record<AppLocalContextFailure, string> = {
  timeout: "Checking your account took too long. Please try again.",
  network: "Please check your connection and try again.",
  unavailable: "We couldn't check your account. Please try again.",
  "sign-in": "Please sign in again to open this page.",
  access: "You don't have access to this page. Check your workspace and try again.",
  workspace: "Your workspace changed. Please verify it before opening this page.",
  verification: "App access needs to be verified. Please try again.",
  reset: "Your app session changed. Please verify it to reopen this page.",
  invalid: "App access could not be checked. Please try again.",
};
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
function usable(admission?: Admission, path = location.pathname + location.search): admission is Admission {
  if (!admission) return false;
  const generation = window.__reylumiAppLocalContext?.generation;
  if (admission.generation !== generation) return false;
  return canAdmitAppLocalPage(admission.value, path, { generation, online: navigator.onLine });
}
function expiredCachedContext(value: AppLocalContext) {
  const grant = value?.grant, generation = window.__reylumiAppLocalContext?.generation;
  return value?.schemaVersion === 1 && value.offline === true && isAppLocalScopeId(value.context?.scope)
    && value.offlineState !== "unconfirmed" && ![401, 403, 409].includes(value.grantStatus ?? 0)
    && Boolean(grant && grant.expiresAt <= Date.now() && value.context.viewerId === grant.viewerId
      && isExperienceOfflineGrant(grant, { scope: value.context.scope, ...(generation ? { generation } : {}) }, grant.expiresAt - 1));
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
  const [admissions, setAdmissions] = useState<Partial<Record<AuthorityFamily, Admission>>>({}), [error, setError] = useState<false | AppLocalContextFailure>(false), [visited, setVisited] = useState<string[]>([]);
  const [helpPresentation, setHelpPresentation] = useState<Admission | null>(null);
  const current = useRef(path), admitted = useRef(admissions), contextEpoch = useRef(0), request = useRef<ContextCheck | null>(null);
  const recoveryAttempts = useRef(new Set<string>());
  const nativeResetPending = useRef<NativeResetPending | null>(null);
  const finishNativeResetPending = useCallback(() => {
    const pending = nativeResetPending.current;
    if (pending?.timer !== undefined) { clearTimeout(pending.timer); pending.timer = undefined; }
    // Retain the handled metadata: an identical delivery is not a new reset.
  }, []);
  const staleScopes = useRef(new Map<string, number>()), conflictRevision = useRef(0);
  const handoffPath = useRef<string | null>(null), acceptedHostEpoch = useRef(-1);
  const workspaceRecovery = useRef<WorkspaceRecovery | null>(null), workspaceResolution = useRef<WorkspaceResolution | null>(null);
  const workspaceGesture = useRef<WorkspaceGesture | null>(null);
  const roleReturn = useRef<{ viewerId: string; generation: string } | null>(null);
  const pageRecovery = useRef<PageRecovery | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [openingSignIn, setOpeningSignIn] = useState(false), [signInError, setSignInError] = useState(false);
  const [guestContinuation, setGuestContinuation] = useState(0);
  const openSignIn = async () => {
    if (openingSignIn) return;
    setOpeningSignIn(true); setSignInError(false);
    try { await getAppLocalHost().openOnline(`/login?${new URLSearchParams({ next: current.current })}`); }
    catch { setSignInError(true); }
    finally { setOpeningSignIn(false); }
  };
  useLayoutEffect(() => { current.current = path; }, [path]);
  const recoverPage = useCallback((value: AppLocalContext, requestedPath: string) => {
    const generation = window.__reylumiAppLocalContext?.generation;
    // Native publishes its context event before the pending handoff callback.
    // Let that destination read finish; its event is not a denied page grant.
    if (requestedPath.split("?")[0] !== current.current.split("?")[0] || workspaceRecovery.current || pageRecovery.current || handoffPath.current
      || !value || value.schemaVersion !== 1 || value.offline || !value.context?.authenticated || !value.context.viewerId
      || !isAppLocalScopeId(value.context.scope) || !generation || value.grantStatus === 401) return false;
    pageRecovery.current = { path: current.current, viewerId: value.context.viewerId, generation };
    window.dispatchEvent(new Event("reylumi:app-local-page-resolve"));
    return true;
  }, []);
  const accept = useCallback((value: AppLocalContext, requestedPath: string, requested = false, readRevision = -1, fresh = false) => {
    const reject = (contextReason: AppLocalContextReason) => { recordExperienceTrace("context.reject", { source: "app-local", contextReason, offline: Boolean(value?.offline), ...appLocalReadTraceFields(value) }); return false; };
    // A neutral workspace read resolves the selected home; it never admits the
    // former Staff route or the destination's private page by itself.
    if (workspaceRecovery.current) return reject("handoff");
    // Native context events from a command preflight may arrive after its reply.
    // During a role handoff only our destination request may admit a page.
    if (handoffPath.current && (!requested || requestedPath !== handoffPath.current)) return reject("handoff");
    // A cancelled native neutral read may still emit its background result.
    // It cannot authorize a page navigated to after that read was cancelled.
    if (!requested && requestedPath === "/" && current.current !== "/") return reject("late-reply");
    if (!value || value.schemaVersion !== 1 || !value.context) return reject("schema");
    if (!isAppLocalScopeId(value.context.scope)) return reject("scope");
    const family = authorityFamily(requestedPath);
    if (family !== authorityFamily(current.current) || isPublic(current.current)) return reject("authority-family");
    if(isAppLocalPortableScopeId(value.context.scope)&&(value.grant?.kind!=="portable"||value.grant.scope!==value.context.scope||value.grant.salonId!==value.context.salonId||value.grant.workspaceId!==value.context.workspaceId))return reject("portable-authority");
    if (family === "portable" && !isAppLocalPortableScopeId(value.context.scope)) return reject("portable-authority");
    if (family !== "portable" && family !== "display" && isAppLocalPortableScopeId(value.context.scope)) return reject("portable-authority");
    const generation = window.__reylumiAppLocalContext?.generation;
    const next = { value, generation };
    const withdrawnAt = staleScopes.current.get(value.context.scope);
    if (withdrawnAt !== undefined && (value.offline || !requested || readRevision < withdrawnAt)) return reject("workspace-changed");
    if (!usable(next, current.current)) {
      // A fresh explicit denial cannot leave an older, still-unexpired private
      // lease visible while its error UI waits for the native reset event.
      if (!value.offline && ([401, 403, 409].includes(value.grantStatus ?? 0) || value.offlineState === "unconfirmed" || value.offlineState === "online-only")) {
        const scoped = requested && fresh && invalidateAppLocalRoleResources(value, generation);
        if (!scoped) clearAppLocalRoleResources();
        roleReturn.current = scoped ? { viewerId: value.context.viewerId!, generation: generation! } : null;
        const denied = Object.entries(admitted.current).filter(([key]) => !value.context.authenticated || key === family);
        for (const [, admission] of denied) if (admission) resetAppLocalResources(admission.value.context.scope);
        admitted.current = Object.fromEntries(Object.entries(admitted.current).filter(([key]) => !denied.some(([deniedKey]) => deniedKey === key)));
        setAdmissions(admitted.current); setAppLocalCommandScope(undefined);
        setHelpPresentation(null);
      }
      return reject(appLocalPageAdmissionReason(value, current.current, { generation, online: navigator.onLine }) ?? "generation");
    }
    const previous = admitted.current[family];
    // A cached bridge reply can arrive after its background online result.
    // Keep the newer verified authority instead of downgrading it to offline
    // and forcing another context check on the next navigation.
    if (value.offline && previous && !previous.value.offline && usable(previous)
      && previous.value.context.viewerId === value.context.viewerId && previous.value.context.scope === value.context.scope
      && previous.value.context.workspaceId === value.context.workspaceId && previous.value.context.permissionRevision === value.context.permissionRevision
      && previous.value.grant?.grantRevision === value.grant?.grantRevision
      && previous.value.onlineValidatedAt >= value.onlineValidatedAt) {
      recordExperienceTrace("auth.skip", { source: "app-local", offline: true });
      return true;
    }
    if (getAppLocalHost().isNative && value.grant) { alignDeviceGeneration(); void acceptExperienceOfflineGrant(value.grant); }
    const all = Object.values(admitted.current);
    const identityChanged = all.some(item => item && (item.value.context.viewerId !== value.context.viewerId || item.generation !== generation));
    const authorityChanged = previous && (previous.value.context.scope !== value.context.scope || previous.value.context.permissionRevision !== value.context.permissionRevision || previous.value.grant && value.grant && previous.value.grant.grantRevision !== value.grant.grantRevision);
    if (identityChanged || authorityChanged) { recordExperienceTrace("cache.reset", { source: "app-local", reason: identityChanged ? "identity" : previous?.value.context.scope !== value.context.scope ? "scope" : "grant", changed: true }); resetAppLocalResources(); clearExperienceState(); setVisited([]); admitted.current = {}; }
    const restoreRole = requested && fresh && handoffPath.current === requestedPath && roleReturn.current?.viewerId === value.context.viewerId && roleReturn.current?.generation === generation;
    reconcileAppLocalRoleResources(value, generation, restoreRole);
    if (!value.offline && (restoreRole || !workspaceGesture.current && !handoffPath.current)) roleReturn.current = null;
    finishNativeResetPending();
    admitted.current = { ...admitted.current, [family]: next }; setAdmissions(admitted.current);
    if (!value.offline) staleScopes.current.delete(value.context.scope);
    acceptedHostEpoch.current = window.__reylumiAppLocalContext?.scopeEpoch ?? -1;
    handoffPath.current = null; setSwitchingWorkspace(false);
    setAppLocalCommandScope(usable(admitted.current[family]) ? value.context.scope : undefined); setError(false);
    recordExperienceTrace("context.accept", { source: "app-local", contextReason: value.grant && isExperienceOfflineGrant(value.grant, { scope: value.context.scope, ...(generation ? { generation } : {}) }) ? "lease-valid" : "online-valid", offline: Boolean(value.offline), changed: Boolean(identityChanged || authorityChanged), identityChanged, generationChanged: all.some(item => item && item.generation !== generation), scopeChanged: Boolean(previous && previous.value.context.scope !== value.context.scope), permissionChanged: Boolean(previous && previous.value.context.permissionRevision !== value.context.permissionRevision), grantChanged: Boolean(previous?.value.grant && value.grant && previous.value.grant.grantRevision !== value.grant.grantRevision), ...appLocalReadTraceFields(value) });
    return true;
  }, [finishNativeResetPending]);
  const verify = useCallback((options?: { fresh?: boolean; trigger?: ExperienceTraceTrigger }): Promise<void> => {
    // All automatic checks join a workspace resolution. They must not restart
    // the old Staff path while its selected account workspace is being read.
    if (workspaceRecovery.current) return workspaceResolution.current?.promise ?? Promise.resolve();
    if (isPublic(current.current)) return Promise.resolve();
    finishNativeResetPending();
    const requestedPath = current.current, fresh = Boolean(options?.fresh || handoffPath.current);
    const previous = request.current;
    if (previous?.path === requestedPath && !previous.controller.signal.aborted) {
      recordExperienceTrace("auth.join", { source: "app-local", trigger: options?.trigger ?? "unknown", fresh });
      // Foreground/online events join the current check. If it can return a
      // display lease, follow it with one fresh check without cancelling it.
      previous.requireFresh ||= fresh;
      return previous.promise!;
    }
    const started = ++contextEpoch.current;
    if (previous) recordExperienceTrace("auth.abort", { source: "app-local", trigger: options?.trigger ?? "unknown" });
    previous?.controller.abort();
    const controller = new AbortController();
    const check: ContextCheck = { path: requestedPath, controller, requireFresh: fresh };
    request.current = check;
    const operation = nextExperienceTraceOperation(), began = operation ? performance.now() : 0;
    recordExperienceTrace("auth.start", { source: "app-local", trigger: options?.trigger ?? "unknown", fresh, operation });
    setError(false);
    check.promise = Promise.resolve().then(async () => {
      let forceFresh = fresh, cancellationRevalidated = false, readRevision = conflictRevision.current;
      try {
        while (!controller.signal.aborted && started === contextEpoch.current) {
          const read = async () => {
            readRevision = conflictRevision.current;
            const readOperation = nextExperienceTraceOperation(), readStarted = readOperation ? performance.now() : 0;
            recordExperienceTrace("context.read.start", { source: "app-local", operation: readOperation, fresh: forceFresh });
            try {
              const value = await getAppLocalHost().context(requestedPath, { signal: controller.signal, fresh: forceFresh });
              recordExperienceTrace("context.read.end", { source: "app-local", operation: readOperation, status: 200, offline: Boolean(value.offline), durationMs: readOperation ? performance.now() - readStarted : 0, ...appLocalReadTraceFields(value) });
              return value;
            } catch (cause) {
              recordExperienceTrace("context.read.end", { source: "app-local", operation: readOperation, status: (cause as { status?: number })?.status, durationMs: readOperation ? performance.now() - readStarted : 0, ...appLocalReadTraceFields(cause) });
              throw cause;
            }
          };
          // Retry only a cold read with a known transient transport failure.
          // Admission rejection, permission checks and commands are not retried.
          let value: AppLocalContext;
          try {
            value = usable(admitted.current[authorityFamily(requestedPath)])
              ? await read() : await runAppLocalContextRead(read, controller.signal);
          } catch (cause) {
            // A native stale-cookie response is discarded with cancellation.
            // Rejoin current authority once through a fresh GET, never replay a
            // command or keep retrying a repeated native cancellation.
            if (isAppLocalContextCancellation(cause) && !cancellationRevalidated && !controller.signal.aborted && started === contextEpoch.current && current.current === requestedPath) {
              cancellationRevalidated = true; forceFresh = true;
              recordExperienceTrace("auth.join", { source: "app-local", status: -999, contextReason: "late-reply", fresh: true, operation });
              continue;
            }
            throw cause;
          }
          if (controller.signal.aborted || started !== contextEpoch.current) return;
          // A lease may expire while its bridge callback is paused in background.
          // Never admit it; honor the fresh check already requested on resume.
          if (!forceFresh && (check.requireFresh && expiredCachedContext(value) || value.offline && staleScopes.current.has(value.context.scope))) { forceFresh = true; continue; }
          const withdrawnAt = staleScopes.current.get(value.context.scope);
          if (!value.offline && withdrawnAt !== undefined && readRevision < withdrawnAt) { forceFresh = true; continue; }
          if (!accept(value, requestedPath, true, readRevision, forceFresh)) {
            const contextReason = !value || value.schemaVersion !== 1 || !value.context ? "schema" : !isAppLocalScopeId(value.context.scope) ? "scope" : appLocalPageAdmissionReason(value, requestedPath, { generation: window.__reylumiAppLocalContext?.generation, online: navigator.onLine }) ?? "authority-family";
            recordExperienceTrace("context.reject", { source: "app-local", contextReason, operation });
            // A saved Owner route may outlive the server-selected Staff role.
            // Resolve the current server home once; never submit a role change
            // or admit this denied DTO merely because the HTTP read succeeded.
            if (recoverPage(value, requestedPath)) return;
            throw appLocalAdmissionError(contextReason, value.grantStatus);
          }
          if (check.requireFresh && !forceFresh) { forceFresh = true; continue; }
          return;
        }
      } catch (cause) {
        recordExperienceTrace(controller.signal.aborted ? "auth.abort" : "auth.reject", { source: "app-local", operation, status: (cause as { status?: number })?.status, contextReason: appLocalContextFailureReason(cause) });
        if (!controller.signal.aborted && started === contextEpoch.current) { setError(classifyAppLocalContextFailure(cause)); setSwitchingWorkspace(false); }
      } finally { recordExperienceTrace("auth.end", { source: "app-local", operation, durationMs: operation ? performance.now() - began : 0 }); if (request.current === check) request.current = null; }
    });
    return check.promise;
  }, [accept, recoverPage, finishNativeResetPending]);
  useEffect(() => () => { finishNativeResetPending(); contextEpoch.current++; request.current?.controller.abort(); workspaceResolution.current?.controller.abort(); }, [finishNativeResetPending]);
  const transition = useCallback((destination: string) => {
    const previous = current.current;
    if (previous !== destination && pageRecovery.current?.target !== destination) pageRecovery.current = null;
    if (handoffPath.current && handoffPath.current !== destination) { handoffPath.current = null; setSwitchingWorkspace(false); }
    if (isHelp(destination)) {
      if (!isHelp(previous)) {
        const outgoing = admitted.current[authorityFamily(previous)];
        setHelpPresentation(!isPublic(previous) && usable(outgoing) && outgoing.value.context.authenticated
          && authorityFamily(previous) !== "portable" && authorityFamily(previous) !== "display" ? outgoing : null);
      }
    } else setHelpPresentation(null);
    if (previous !== destination) { finishNativeResetPending(); contextEpoch.current++; request.current?.controller.abort(); workspaceResolution.current?.controller.abort(); workspaceResolution.current = null; workspaceRecovery.current = null; workspaceGesture.current = null; recoveryAttempts.current.clear(); setError(false); }
    current.current = destination;
    readPriorityScheduler.setActiveRoute(destination);
    const target = admitted.current[authorityFamily(destination)];
    setAppLocalCommandScope(!isPublic(destination) && usable(target, destination) ? target.value.context.scope : undefined);
    setVisited(paths => [...new Set([...paths, previous, destination])].slice(-16)); setPath(destination);
  }, [finishNativeResetPending]);
  const navigate = useCallback((value: string, replace = false) => {
    let destination: string; try { destination = appLocalPath(value); } catch { return; }
    destination=appLocalRouteAlias(destination)??destination;
    if (!isPublic(destination) && !ownerPaths.has(destination.split("?")[0]) && !getAppLocalPage(destination)) { void getAppLocalHost().openOnline(destination); return; }
    // Selecting a page again is an explicit recovery attempt when its initial
    // session check failed. History/state do not change for the same route.
    const retryCurrent = destination === current.current && !isPublic(destination)
      && !usable(admitted.current[authorityFamily(destination)]) && !request.current && !handoffPath.current;
    // Capture the outgoing page before our history observer sees the new URL.
    transition(destination);
    (replace ? history.replaceState : history.pushState).call(history, {}, "", destination);
    if (retryCurrent) { recoveryAttempts.current.clear(); void verify({ fresh: true }); }
  }, [transition, verify]);
  const continueAsGuest = useCallback(() => {
    // Acknowledge the expiry presentation at either Guest control. The next
    // public page still obtains its own ordinary context admission.
    setGuestContinuation(previous => previous + 1);
    navigate("/explore");
  }, [navigate]);
  useEffect(()=>installAppLocalLinkNavigation({navigate,isLocalRoute:href=>isPublic(href)||ownerPaths.has(href.split("?")[0])||Boolean(getAppLocalPage(href)),openOnline:path=>getAppLocalHost().openOnline(path),getScope:getAppLocalCommandScope,helpImagePaths:APP_LOCAL_REFERENCE_ASSETS}),[navigate]);
  useEffect(() => {
    const saved = admitted.current[authorityFamily(path)];
    // A recent online admission already verified this family. Commands still
    // authorize on the server; foreground and access failures force rechecking.
    const recent = usable(saved) && !saved.value.offline && Date.now() - saved.value.onlineValidatedAt < 30_000;
    if (!isPublic(path) && !recent && !handoffPath.current) void verify({ trigger: "mount" });
  }, [path, verify]);
  useEffect(() => {
    const nav = (event: Event) => { const value = (event as CustomEvent<{ path?: string }>).detail?.path; if (value) navigate(value); };
    const fresh = (event: Event) => {
      const value = captureAppLocalReadTrace((event as CustomEvent<AppLocalContext & { contextPath?: string; host?: typeof window.__reylumiAppLocalContext }>).detail);
      if (typeof value?.contextPath !== "string" || accept(value, value.contextPath)) return;
      const pending = nativeResetPending.current, host = window.__reylumiAppLocalContext;
      // A current native denial is an actual result, not a still-pending reset.
      // Stale, cached or malformed DTOs cannot settle this presentation clock.
      if (pending?.timer !== undefined && pending.contextEpoch === contextEpoch.current && pending.path === current.current
        && value.contextPath === current.current.split("?")[0] && value.schemaVersion === 1 && isAppLocalScopeId(value.context?.scope)
        && value.offline === false && Number.isFinite(value.onlineValidatedAt) && Math.abs(Date.now() - value.onlineValidatedAt) < 30_000
        && [401, 403, 409].includes(value.grantStatus ?? 0) && host?.generation === pending.generation && host.scopeEpoch === pending.scopeEpoch
        && value.host?.version === 1 && value.host.generation === host.generation && value.host.scopeEpoch === host.scopeEpoch && value.host.nonce === host.nonce) {
        finishNativeResetPending(); setError(classifyAppLocalContextFailure({ status: value.grantStatus }));
      }
      if (!staleScopes.current.has(value.context?.scope)) recoverPage(value, value.contextPath);
    };
    const scopeConflict = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; generation?: string }>).detail;
      if (!detail?.scope || detail.generation && detail.generation !== window.__reylumiAppLocalContext?.generation) return;
      const scope = detail.scope, currentFamily = authorityFamily(current.current);
      const affected = Object.entries(admitted.current).filter(([, admission]) => admission?.value.context.scope === scope);
      // An old page's reply cannot withdraw a newer accepted workspace.
      if (!affected.length) return;
      clearAppLocalRoleResources(scope); roleReturn.current = null;
      const activeAffected = affected.some(([family]) => family === currentFamily);
      staleScopes.current.set(scope, ++conflictRevision.current);
      resetAppLocalResources(scope);
      admitted.current = Object.fromEntries(Object.entries(admitted.current).filter(([, admission]) => admission?.value.context.scope !== scope));
      setAdmissions(admitted.current);
      setHelpPresentation(previous => previous?.value.context.scope === scope ? null : previous);
      if (!activeAffected) return;
      setAppLocalCommandScope(undefined);
      // A committed/uncertain role gesture owns its destination check. Never
      // restart the former Staff page or abort that check because an old read
      // discovered the workspace change first.
      if (workspaceGesture.current || workspaceRecovery.current) return;
      const key = `conflict:${currentFamily}:${scope}`;
      if (recoveryAttempts.current.has(key)) { if (!request.current) setError("workspace"); return; }
      recoveryAttempts.current.add(key);
      setError(false);
      void verify({ fresh: true });
    };
    const reset = (event: Event, roleHandoff = false) => {
      const detail = (event as CustomEvent<{ reason?: string; status?: number; scope?: string; scopeEpoch?: number; generation?: string }>).detail;
      // A fresh authority result rotates native delivery metadata. Do not abort
      // the very context read producing it, or clear an already accepted reply.
      if (detail?.reason === "context" && detail.scopeEpoch !== undefined && detail.scopeEpoch <= acceptedHostEpoch.current) return;
      const host = window.__reylumiAppLocalContext;
      const pendingNativeReset = getAppLocalHost().isNative && detail?.reason === "explicitReset"
        && !Object.prototype.hasOwnProperty.call(detail, "status") && !isPublic(current.current)
        && host?.version === 1 && typeof detail.generation === "string" && detail.generation === host.generation
        && Number.isSafeInteger(detail.scopeEpoch) && detail.scopeEpoch === host.scopeEpoch;
      // Native reset() rotates metadata before publishing. A repeated delivery
      // must not abort a newer workflow or restart its original 25s deadline.
      if (pendingNativeReset && nativeResetPending.current?.generation === host!.generation
        && nativeResetPending.current.scopeEpoch === host!.scopeEpoch) return;
      finishNativeResetPending();
      // A validated gesture may rotate native delivery metadata before its
      // command reply arrives. Keep only quarantined DTOs, never old admission.
      const preserveRoleReads = roleHandoff || detail?.reason === "context" && roleReturn.current?.generation === window.__reylumiAppLocalContext?.generation;
      if (!preserveRoleReads) { clearAppLocalRoleResources(); roleReturn.current = null; }
      const contextReason = detail?.reason === "logout" ? "logout" : appLocalContextFailureReason({ status: detail?.status, contextReason: "reset" });
      recordExperienceTrace("cache.reset", { source: "app-local", trigger: "reset", reason: detail?.reason === "context" ? "grant" : detail?.reason === "resource" ? "resource" : "reset", contextReason, status: detail?.status });
      if (detail?.reason !== "context") { contextEpoch.current++; request.current?.controller.abort(); workspaceResolution.current?.controller.abort(); workspaceResolution.current = null; workspaceRecovery.current = null; workspaceGesture.current = null; pageRecovery.current = null; handoffPath.current = null; setSwitchingWorkspace(false); }
      alignDeviceGeneration(); void clearExperienceSnapshots({ rotateGeneration: false }); clearExperienceState(); resetAppLocalResources(); setAppLocalCommandScope(undefined); admitted.current = {}; setAdmissions({}); setHelpPresentation(null); setVisited([]); setError(detail?.reason === "context" || pendingNativeReset ? false : classifyAppLocalContextFailure({ status: detail?.status, contextReason }));
      if (pendingNativeReset) {
        const pending: NativeResetPending = { generation: host!.generation, scopeEpoch: host!.scopeEpoch, path: current.current, contextEpoch: contextEpoch.current };
        nativeResetPending.current = pending;
        // The hosted return owns its fresh context read. Keep old authority
        // withdrawn without launching a competing GET against the former role.
        pending.timer = setTimeout(() => {
          if (nativeResetPending.current !== pending || pending.timer === undefined) return;
          pending.timer = undefined;
          const currentHost = window.__reylumiAppLocalContext;
          if (pending.contextEpoch !== contextEpoch.current || pending.path !== current.current
            || pending.generation !== currentHost?.generation || pending.scopeEpoch !== currentHost.scopeEpoch
            || usable(admitted.current[authorityFamily(current.current)]) || request.current
            || workspaceResolution.current || workspaceRecovery.current || workspaceGesture.current || handoffPath.current || pageRecovery.current
            || isPublic(current.current) || getAppLocalPage(current.current)?.requiresContext === false) return;
          setError("reset");
        }, 25_000);
      }
      const key = `${authorityFamily(current.current)}:${detail?.scope ?? ""}`;
      // One fresh authority recovery per user navigation. Context rejection or
      // a second failing read stops at an actionable retry, never a retry loop.
      if (detail?.reason === "resource" && !isPublic(current.current) && !recoveryAttempts.current.has(key)) {
        recoveryAttempts.current.add(key); setError(false); void verify({ fresh: true });
      }
    };
    const handoff = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; gesture?: WorkspaceGesture }>).detail;
      const value = detail?.path;
      if (!value) return;
      if (detail.gesture && (!workspaceGesture.current || detail.gesture.generation !== workspaceGesture.current.generation
        || detail.gesture.scope !== workspaceGesture.current.scope || detail.gesture.workspaceId !== workspaceGesture.current.workspaceId)) return;
      let destination: string; try { destination = appLocalPath(value); } catch { return; }
      // Clear the old authority before any destination can render. Commands
      // have already finished; retry only the fresh read, never the write.
      reset(new Event("reylumi:app-local-reset"), Boolean(roleReturn.current));
      handoffPath.current = destination; setSwitchingWorkspace(true); setError(false);
      navigate(destination);
      if (!isPublic(current.current)) void verify({ fresh: true });
    };
    const startWorkspace = (event: Event) => {
      const detail = (event as CustomEvent<{ generation?: string; scope?: string; workspaceId?: string }>).detail;
      const former = admitted.current[authorityFamily(current.current)];
      if (!detail?.generation || detail.generation !== window.__reylumiAppLocalContext?.generation
        || detail.scope !== getAppLocalCommandScope() || former?.generation !== detail.generation
        || former.value.context.scope !== detail.scope || !former.value.context.authenticated || !former.value.context.viewerId) return;
      // Retain identity only for this in-flight gesture, not display authority.
      // A same-generation context rotation may withdraw its old admission before
      // an uncertain reply arrives; recovery must still bind the original user.
      workspaceGesture.current = { viewerId: former.value.context.viewerId, generation: detail.generation, scope: detail.scope,
        ...(typeof detail.workspaceId === "string" ? { workspaceId: detail.workspaceId } : {}) };
      rememberAppLocalRoleResources(former.value, detail.generation);
      roleReturn.current = { viewerId: former.value.context.viewerId, generation: detail.generation };
    };
    const finishWorkspace = (event: Event) => {
      const detail = (event as CustomEvent<{ generation?: string; scope?: string }>).detail;
      if (detail?.generation === workspaceGesture.current?.generation && detail?.scope === workspaceGesture.current?.scope) workspaceGesture.current = null;
      if (!handoffPath.current && !workspaceRecovery.current) roleReturn.current = null;
    };
    const resolveWorkspace = (event?: Event) => {
      const detail = (event as CustomEvent<{ generation?: string; workspaceId?: string; gesture?: WorkspaceGesture }> | undefined)?.detail;
      const generation = window.__reylumiAppLocalContext?.generation;
      if (detail?.gesture && (!workspaceGesture.current || detail.gesture.generation !== workspaceGesture.current.generation
        || detail.gesture.scope !== workspaceGesture.current.scope || detail.gesture.workspaceId !== workspaceGesture.current.workspaceId)) return;
      if (!generation || detail?.generation && detail.generation !== generation) return;
      if (workspaceResolution.current) return;
      const former = admitted.current[authorityFamily(current.current)];
      const pageAttempt = event?.type === "reylumi:app-local-page-resolve" ? pageRecovery.current : null;
      if (event?.type === "reylumi:app-local-page-resolve" && (!pageAttempt || pageAttempt.path !== current.current || pageAttempt.generation !== generation)) return;
      const saved = workspaceRecovery.current ?? pageAttempt ?? workspaceGesture.current;
      const viewerId = saved?.viewerId ?? former?.value.context.viewerId;
      if (!viewerId || saved && saved.generation !== generation) return;
      const identity: WorkspaceRecovery = saved ?? { viewerId, generation, ...(typeof detail?.workspaceId === "string" ? { workspaceId: detail.workspaceId } : {}) };
      reset(new Event("reylumi:app-local-reset"), Boolean(roleReturn.current));
      if (pageAttempt) pageRecovery.current = pageAttempt;
      workspaceRecovery.current = identity;
      handoffPath.current = "/"; setSwitchingWorkspace(true); setError(false);
      const controller = new AbortController(), resolution: WorkspaceResolution = { controller };
      workspaceResolution.current = resolution;
      const started = contextEpoch.current;
      resolution.promise = Promise.resolve().then(async () => {
        try {
          const value = await runAppLocalContextRead(() => getAppLocalHost().context("/", { fresh: true, signal: controller.signal }), controller.signal);
          if (controller.signal.aborted || workspaceResolution.current !== resolution || contextEpoch.current !== started
            || window.__reylumiAppLocalContext?.generation !== identity.generation) return;
          if (!value.context?.authenticated || value.context.viewerId !== identity.viewerId || [401, 403, 409].includes(value.grantStatus ?? 0)) {
            throw appLocalAdmissionError(value.context?.authenticated ? "workspace-changed" : "sign-in", value.grantStatus);
          }
          if (value.offline || value.offlineState === "unconfirmed" || !value.home || !usable({ value, generation: identity.generation }, "/")) {
            throw Object.assign(new Error("Workspace access could not be confirmed"), { status: 503 });
          }
          const destination = appLocalPath(value.home);
          if (destination === "/" || (!isPublic(destination) && !ownerPaths.has(destination.split("?")[0]) && !getAppLocalPage(destination))) throw appLocalAdmissionError("workspace-home");
          if (pageAttempt) pageAttempt.target = destination;
          // Only the server-selected home is used, then its existing fresh
          // route authorization runs. A neutral context is never a page grant.
          workspaceRecovery.current = null; workspaceResolution.current = null;
          handoffPath.current = destination;
          navigate(destination);
          const destinationPath = current.current;
          const admission = verify({ fresh: true });
          const destinationEpoch = contextEpoch.current;
          await admission;
          if (identity.workspaceId && value.context.workspaceId !== identity.workspaceId
            && window.__reylumiAppLocalContext?.generation === identity.generation
            && contextEpoch.current === destinationEpoch && current.current === destinationPath
            && admitted.current[authorityFamily(destinationPath)]?.value.context.viewerId === identity.viewerId) {
            window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-error", { detail: "Your workspace did not change. Please select the workspace again." }));
          }
        } catch (cause) {
          recordExperienceTrace("auth.reject", { source: "app-local", contextReason: appLocalContextFailureReason(cause), status: (cause as { status?: number })?.status });
          if (!controller.signal.aborted && workspaceResolution.current === resolution && contextEpoch.current === started) {
            setSwitchingWorkspace(false); setError(classifyAppLocalContextFailure(cause));
          }
        } finally { if (workspaceResolution.current === resolution) workspaceResolution.current = null; }
      });
    };
    const retryWorkspace = () => { recoveryAttempts.current.clear(); if (workspaceRecovery.current) resolveWorkspace(); else { setSwitchingWorkspace(true); void verify({ fresh: true }); } };
    const resume = (event: Event) => { if (workspaceRecovery.current) resolveWorkspace(); else void verify({ fresh: true, trigger: event.type === "online" ? "online" : "foreground" }); };
    let accessCheck: ReturnType<typeof setTimeout> | undefined;
    const revalidateAccess = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (isPublic(current.current) || admitted.current[authorityFamily(current.current)]?.value.context.scope !== scope || accessCheck) return;
      accessCheck = setTimeout(() => { accessCheck = undefined; if (!isPublic(current.current) && admitted.current[authorityFamily(current.current)]?.value.context.scope === scope) void verify({ fresh: true }); }, 50);
    };
    const pop = () => transition(appLocalPath(location.pathname + location.search));
    window.addEventListener("reylumi:app-local-navigate", nav); window.addEventListener("reylumi:app-local-context", fresh); window.addEventListener("reylumi:app-local-reset", reset); window.addEventListener("reylumi:app-local-access-changed", reset); window.addEventListener("popstate", pop);window.addEventListener("reylumi:app-local-history",pop);
    window.addEventListener("reylumi:app-local-scope-conflict", scopeConflict);
    window.addEventListener("online", resume); window.addEventListener("reylumi:foreground", resume);
    window.addEventListener("reylumi:app-local-revalidate-access", revalidateAccess);
    window.addEventListener("reylumi:app-local-workspace-start", startWorkspace); window.addEventListener("reylumi:app-local-workspace-finish", finishWorkspace); window.addEventListener("reylumi:app-local-workspace-handoff", handoff); window.addEventListener("reylumi:app-local-workspace-resolve", resolveWorkspace); window.addEventListener("reylumi:app-local-page-resolve", resolveWorkspace); window.addEventListener("reylumi:app-local-workspace-retry", retryWorkspace);
    return () => { clearTimeout(accessCheck); window.removeEventListener("reylumi:app-local-workspace-start", startWorkspace); window.removeEventListener("reylumi:app-local-workspace-finish", finishWorkspace); window.removeEventListener("reylumi:app-local-workspace-handoff", handoff); window.removeEventListener("reylumi:app-local-workspace-resolve", resolveWorkspace); window.removeEventListener("reylumi:app-local-page-resolve", resolveWorkspace); window.removeEventListener("reylumi:app-local-workspace-retry", retryWorkspace); window.removeEventListener("reylumi:app-local-revalidate-access", revalidateAccess); window.removeEventListener("reylumi:app-local-scope-conflict", scopeConflict); window.removeEventListener("reylumi:app-local-navigate", nav); window.removeEventListener("reylumi:app-local-context", fresh); window.removeEventListener("reylumi:app-local-reset", reset); window.removeEventListener("reylumi:app-local-access-changed", reset); window.removeEventListener("popstate", pop);window.removeEventListener("reylumi:app-local-history",pop); window.removeEventListener("online", resume); window.removeEventListener("reylumi:foreground", resume); };
  }, [navigate, accept, verify, transition, recoverPage, finishNativeResetPending]);
  const activeAdmission = admissions[authorityFamily(path)], context = !isPublic(path) && usable(activeAdmission) ? activeAdmission.value : null;
  useAppLocalPrefetch(context, path);
  const refreshNavigation = useCallback(() => { void verify(); }, [verify]);
  const checkSession = useCallback(() => verify({ fresh: true, trigger: "interval" }), [verify]);
  const diagnosticBlocked = !isPublic(path) && !context;
  useLayoutEffect(() => { recordExperienceTrace(diagnosticBlocked ? "gate.hide" : "gate.show", { source: "app-local", blocked: diagnosticBlocked }); }, [diagnosticBlocked]);
  useEffect(() => {
    if (activeAdmission?.value.offlineState !== "online-only") return;
    const captured = activeAdmission, family = authorityFamily(path);
    const remaining = captured.value.onlineValidatedAt + 30_000 - Date.now();
    const withdraw = (disconnected: boolean) => {
      if (admitted.current[family] !== captured || authorityFamily(current.current) !== family) return;
      contextEpoch.current++; request.current?.controller.abort();
      resetAppLocalResources(captured.value.context.scope);
      admitted.current = Object.fromEntries(Object.entries(admitted.current).filter(([key]) => key !== family));
      setAdmissions(admitted.current); setAppLocalCommandScope(undefined);
      setError(disconnected ? "network" : "verification");
      if (!disconnected && navigator.onLine) void verify({ fresh: true, trigger: "interval" });
    };
    const offline = () => withdraw(true);
    window.addEventListener("offline", offline);
    // Reconcile a disconnect that happened before this effect subscribed.
    if (!navigator.onLine) {
      withdraw(true);
      return () => window.removeEventListener("offline", offline);
    }
    // Recheck quietly before the proof ends. Failure never extends its lifetime.
    const renew = setTimeout(() => {
      if (navigator.onLine && admitted.current[family] === captured && authorityFamily(current.current) === family) void verify({ fresh: true, trigger: "interval" });
    }, Math.max(0, remaining - 10_000));
    const expiry = setTimeout(() => withdraw(!navigator.onLine), Math.max(0, remaining));
    return () => { clearTimeout(renew); clearTimeout(expiry); window.removeEventListener("offline", offline); };
  }, [activeAdmission, path, verify]);
  // Help can display the already admitted role chrome, but receives no account
  // context or command scope. A cold public launch never manufactures one.
  const presentationContext = isHelp(path) && usable(helpPresentation ?? undefined) ? helpPresentation!.value : null;
  useEffect(() => {
    if (!context?.grant) return;
    const remaining = context.grant.expiresAt - Date.now();
    recordExperienceTrace("timer.schedule", { source: "app-local", trigger: "lease-expiry", durationMs: remaining });
    let fired = false;
    const timer = setTimeout(() => { fired = true; recordExperienceTrace("timer.fire", { source: "app-local", trigger: "lease-expiry" }); window.dispatchEvent(new Event("reylumi:app-local-access-changed")); void verify({ fresh: true, trigger: "lease-expiry" }); }, Math.max(0, Math.min(remaining, 2147483647)));
    return () => { if (!fired) recordExperienceTrace("timer.cancel", { source: "app-local", trigger: "lease-expiry" }); clearTimeout(timer); };
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
  useLayoutEffect(() => { recordExperienceTrace("route.reveal", { source: "app-local" }); window.dispatchEvent(new Event("reylumi:screen-ready")); }, [path]);
  useLayoutEffect(() => { recordExperienceTrace("boot.ready", { source: "app-local" }); }, []);
  const ownerAdmission = admissions.account, ownerContext = ownerAdmission?.value;
  const owner = ownerContext?.grant?.kind === "owner" || Boolean(ownerContext && !ownerContext.offline && ownerContext.access?.ownerWorkspace);
  const windows=new Map<string,string>();for(const href of [...visited,path])if(!isPublic(href)&&getAppLocalPage(href))windows.set(pageKey(href),href);
  const ownerVisited=ownerPaths.has(path.split("?")[0])||visited.some(href=>ownerPaths.has(href.split("?")[0]));
  return <AppLocalNavigationProvider value={{ path, navigate, refresh: refreshNavigation }}><ExperienceScopeProvider context={context?.context ?? publicExperience}><AppLocalShell context={context} presentationContext={presentationContext} path={path} checkContext={checkSession} onContinueAsGuest={continueAsGuest} guestContinuation={guestContinuation}>
    <div className="app-local-body" data-app-local-ready="true">
      {isPublic(path) ? <div className="app-local-page"><PublicPage path={path} navigate={navigate} experienceScope={presentationContext?.context.scope} /></div> : null}
      {!isPublic(path) && !context && (error || getAppLocalPage(path)?.requiresContext !== false) ? <section className="p-6" aria-busy={!error} data-context-failure={error || undefined}>{error ? <><h1 className="text-xl font-semibold">{getAppLocalPage(path)?.title ?? "POS"}</h1><p className="mt-4">{contextFailureMessages[error]}</p><button disabled={error === "sign-in" && openingSignIn} className="mt-4 rounded border px-4 py-2" onClick={() => { if (error === "sign-in") { void openSignIn(); return; } recoveryAttempts.current.clear(); if (workspaceRecovery.current) window.dispatchEvent(new Event("reylumi:app-local-workspace-retry")); else void verify({ fresh: true }); }}>{error === "sign-in" ? "Sign in" : "Try again"}</button>{error === "sign-in" ? <button type="button" className="ml-3 mt-4 rounded border px-4 py-2" onClick={continueAsGuest}>Continue as guest</button> : null}{error === "sign-in" && signInError ? <p role="alert" className="mt-3">Sign-in could not be opened. Check your connection and try again.</p> : null}{typeof window.__reylumiExportDiagnostics === "function" ? <button type="button" className="mt-4 block rounded border px-4 py-2" onClick={() => window.__reylumiExportDiagnostics?.()}>Save diagnostic report</button> : null}</> : <><LumiLoadingStatus />{switchingWorkspace ? <p role="status" className="mt-4 text-center text-sm text-zinc-600">Switching workspace…</p> : null}</>}</section> : null}
      {context && !owner && ownerPaths.has(path.split("?")[0]) ? <section className="p-6" aria-busy={!error}><h1 className="text-xl font-semibold">{path.startsWith("/pos/check-in") ? "Check In" : "POS"}</h1><p className="mt-4">{error || context.offline ? "Connect to verify access to this workspace." : "Opening your workspace…"}</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void verify()}>Try again</button></section> : null}
        {ownerContext && owner && ownerVisited && ownerContext.context.salonId ? <div className="app-local-page" key={"owner:" + privateAdmissionKey(ownerAdmission)} hidden={!context || !ownerPaths.has(path.split("?")[0])}><ExperienceScopeProvider context={ownerContext.context} guardForms={false}><PageBoundary recover={() => void verify()}><OwnerPages context={ownerContext} path={path} navigate={navigate} active={Boolean(context && ownerPaths.has(path.split("?")[0]))} /></PageBoundary></ExperienceScopeProvider></div> : null}
        {!context && activeAdmission && getAppLocalPage(path)?.requiresContext === false ? (() => { const page = getAppLocalPage(path)!; return <div className="app-local-page"><page.Component context={null} path={path} navigate={navigate} /></div>; })() : null}
        {[...windows].map(([key,href]) => {
          const page = getAppLocalPage(href), admission = admissions[authorityFamily(href)], ownContext = admission?.value ?? null;
          const active = key === pageKey(path) && (usable(admission) || !admission && !page?.requiresContext);
          return page && (ownContext || !page.requiresContext) ? <Activity mode={active ? "visible" : "hidden"} key={page.requiresContext || ownContext?.context.authenticated ? key + ":" + privateAdmissionKey(admission) : key}><div className="app-local-page"><AppLocalNavigationProvider value={{path:href,navigate,refresh:refreshNavigation}}><ExperienceScopeProvider context={ownContext?.context ?? publicExperience} guardForms={false}><PageBoundary recover={() => void verify()}><page.Component context={ownContext} path={href} navigate={navigate} /></PageBoundary></ExperienceScopeProvider></AppLocalNavigationProvider></div></Activity> : null;
        })}
    </div>
  </AppLocalShell></ExperienceScopeProvider></AppLocalNavigationProvider>;
}
createRoot(document.getElementById("app")!).render(<App />);
