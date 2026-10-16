"use client";

import type { ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";

/** Presentational only: the caller owns the operation and its pending lifetime. */
export function ActionFeedback({
  pending,
  pendingLabel = "Working…",
  children,
}: {
  pending: boolean;
  pendingLabel?: string;
  children: ReactNode;
}) {
  if (!pending) return children;

  return (
    <>
      <span
        aria-hidden="true"
        className="mr-2 inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent align-middle motion-reduce:animate-none"
      />
      <WorkspaceText text={pendingLabel} />
    </>
  );
}
