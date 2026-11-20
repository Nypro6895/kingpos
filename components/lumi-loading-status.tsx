import { LumiLoadingMark } from "./lumi-loading-mark";
import { WorkspaceText } from "./workspace-language";

export function LumiLoadingStatus({ text = "Loading…" }: { text?: string }) {
  return <div className="flex min-h-40 flex-col items-center justify-center gap-4 p-6" role="status" aria-busy="true">
    <LumiLoadingMark />
    <span className="text-sm text-zinc-600"><WorkspaceText text={text} /></span>
  </div>;
}
