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
      className={className}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? pendingLabel : saved ? savedLabel : children}
    </button>
  );
}
