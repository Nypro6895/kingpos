"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type SettingsSubmitButtonProps = {
  children: ReactNode;
  className: string;
  disabled?: boolean;
  pendingLabel?: string;
  saved?: boolean;
  savedLabel?: string;
};

export function SettingsSubmitButton({
  children,
  className,
  disabled = false,
  pendingLabel = "Saving...",
  saved = false,
  savedLabel = "Saved",
}: SettingsSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={className}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? <><span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />{pendingLabel}</> : saved ? savedLabel : children}
    </button>
  );
}
