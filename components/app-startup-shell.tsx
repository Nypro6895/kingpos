import { StartupRecovery } from "./startup-controls";
import { LumiLoadingMark } from "./lumi-loading-mark";
import { StartupReady } from "./startup-ready";

/** Branded wait state; role navigation belongs to the real loaded page. */
export function AppStartupShell({ retry }: { retry?: () => void }) {
  return <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-5 bg-white p-6" data-startup-shell="loading">
    <StartupReady />
    <div role="status" aria-label="Opening Reylumi" aria-busy={!retry}><LumiLoadingMark /></div>
    {retry ? <StartupRecovery retry={retry} /> : <p className="text-sm text-zinc-600">Loading…</p>}
  </div>;
}
