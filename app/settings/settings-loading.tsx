"use client";

import { WorkspaceText } from "@/components/workspace-language";

export function SettingsLoading({ label = "Loading settings…" }: { label?: string }) {
  return <div className="settings-loading" role="status" aria-busy="true">
    <p><span className="settings-loading-spinner" aria-hidden="true"/><WorkspaceText text={label}/></p>
    <div className="settings-loading-rows" aria-hidden="true">
      {[0, 1, 2, 3].map(row=><div key={row}><span/><span/></div>)}
    </div>
  </div>;
}
