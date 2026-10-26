"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";


import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, disabled, pendingLabel = "Saving…", ...props }: ComponentProps<"button"> & { pendingLabel?: string }) {
  const __vt = useWorkspaceTranslation();


  const t = useWorkspaceTranslation();
  const { pending } = useFormStatus();
  return (
    <button {...props} title={__vt(t(props.title))} aria-label={__vt(t(props["aria-label"]))} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? <><span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" /><WorkspaceText text={t(pendingLabel)} /></> : children}
    </button>
  );
}
