"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getAppLocalHost, type AppLocalHost } from "@/lib/app-local-host";
import { createServicesCatalogController, type CatalogMetric } from "@/lib/services-catalog-controller";
import { getServicesCatalogStore, servicesCatalogRuntimeRevision, servicesCatalogScopeActive, subscribeServicesCatalogInvalidation } from "@/lib/services-catalog-runtime";
import type { CatalogPartition, ServicesCatalog } from "@/lib/services-catalog-cache";

// Native preserves URLSession's transport status. Interpret only these known
// transport failures here; HTTP denials and ambiguous server errors stay intact.
async function catalogRead<T>(host: AppLocalHost, name: string, scope: string, signal: AbortSignal) {
  try {
    const value = await host.read<T>(name, {}, { scope, signal });
    if (value.schemaVersion !== 1 || value.offline || value.status !== 200 || value.scope !== scope || !value.data) throw new Error("Connect to verify your access.");
    return value.data;
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (host.isNative && status && [-1001, -1004, -1005, -1009].includes(status)) {
      throw Object.assign(new Error("Could not update services."), { status, kind: status === -1001 ? "timeout" : "network" });
    }
    throw error;
  }
}

function recordCatalogMetric(metric: CatalogMetric) {
  // Device-local timings exclude identity, permissions and business data.
  performance.measure(`reylumi:services-pilot:${metric.name}`, { start: performance.now() - metric.durationMs, duration: metric.durationMs, detail: { run: metric.run } });
}

/** This local pilot is read-only. The existing editor remains an online route. */
export function ServicesCatalogPilot({ scope, serviceId, host = getAppLocalHost() }: { scope: string; serviceId: string | null; host?: AppLocalHost }) {
  const controller = useMemo(() => createServicesCatalogController({
    scope, store: getServicesCatalogStore(),
    async admit(signal) {
      const value = await catalogRead<{ schemaVersion: number; partition: CatalogPartition }>(host, "page.services-catalog-admission", scope, signal);
      if (value.schemaVersion !== 1) throw new Error("Invalid service admission.");
      return value.partition;
    },
    async fetchFresh(partition, signal) {
      return catalogRead<ServicesCatalog>(host, "page.services-catalog", partition.scope, signal);
    },
    metric: recordCatalogMetric,
  }), [scope, host]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const runtimeRevision = useSyncExternalStore(subscribeServicesCatalogInvalidation, servicesCatalogRuntimeRevision, () => 0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || !servicesCatalogScopeActive(scope)) return;
      void controller.refresh();
    };
    const unsubscribe = subscribeServicesCatalogInvalidation(() => { void controller.invalidate(); });
    const visibility = () => { if (document.visibilityState === "hidden") void controller.invalidate(); else refresh(); };
    refresh();
    const timer = setInterval(refresh, 25_000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    window.addEventListener("reylumi:foreground", refresh); document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer); unsubscribe(); controller.dispose();
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      window.removeEventListener("reylumi:foreground", refresh); document.removeEventListener("visibilitychange", visibility);
    };
  }, [controller, scope]);
  useEffect(() => {
    if (!state.data) return;
    performance.measure(`reylumi:services-pilot:${state.phase === "cache" ? "cache-render" : "fresh-render"}`, { start: controller.getStartedAt(), end: performance.now(), detail: { run: state.run } });
  }, [state, controller]);
  // The revision subscription makes context withdrawal visible in the same render.
  void runtimeRevision;
  const visible = servicesCatalogScopeActive(scope) ? state.data : undefined;
  const managerQuery = new URLSearchParams({ live: "1", ...(serviceId ? { service: serviceId } : {}) });
  return <main className="services-page"><div className="services-page__frame grid gap-5 p-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Services</h1><a href={`/services?${managerQuery}`} className="font-semibold underline" onClick={event => { if (!host.isNative || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void host.openOnline(`/services?${managerQuery}`); }}>Manage services</a></div>
    {!visible ? <div role={state.error ? "alert" : "status"}><p>{state.error ?? "Opening services."}</p>{state.error ? <button type="button" onClick={() => { void controller.refresh(); }}>Try again</button> : null}</div> : <>
      <p role="status" className="text-sm text-text-secondary">{state.stale ? state.error : state.phase === "cache" ? "Updating services. Check current details before making changes." : "Service catalog"}</p>
      {visible.services.length ? <ul className="grid gap-3">{visible.services.map(service => <li key={service.id} className="rounded-xl border p-4">
        <div className="flex justify-between gap-4"><h2 className="font-semibold">{service.name}</h2><span>{service.basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        <p className="text-sm text-text-secondary">{service.category ? `${service.category} · ` : ""}{service.durationMinutes} min</p>
        {service.description ? <p>{service.description}</p> : null}
      </li>)}</ul> : <p>No services yet.</p>}
    </>}
  </div></main>;
}
