"use client";
import { WorkspaceText } from "@/components/workspace-language";

import { useWorkspaceTranslation } from "@/components/workspace-language";
import type { ReactNode } from "react";
import { CompactFilters } from "@/components/compact-filters";
import { WorkspaceToolbar } from "@/components/workspace-toolbar";
export function PayrollFilterToolbar({ summary, periodLabel, active = false, children }: {
  summary: ReactNode; periodLabel: string; active?: boolean; children: ReactNode;
}) {
  const __vt = useWorkspaceTranslation();

  return <WorkspaceToolbar><div className="min-w-0 flex-1 text-sm text-zinc-600">{summary}</div>
    <CompactFilters label={__vt("Payroll filters")} active={active}>
      <p className="mb-3 text-xs text-zinc-500"><WorkspaceText text={periodLabel} /></p>
      <div className="grid min-w-0 gap-4 [&_input]:max-w-full [&_select]:max-w-full">{children}</div>
    </CompactFilters>
  </WorkspaceToolbar>;
}
