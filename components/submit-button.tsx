"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, disabled, pendingLabel = "Saving…", ...props }: ComponentProps<"button"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? <><span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />{pendingLabel}</> : children}
    </button>
  );
}
