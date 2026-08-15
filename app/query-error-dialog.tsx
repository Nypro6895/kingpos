"use client";

import { ActionDialog } from "@/app/action-dialog";
import { useState } from "react";

type QueryErrorDialogProps = {
  description?: string;
  message: string | null | undefined;
  primaryHref?: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  title: string;
};

export function QueryErrorDialog({
  description,
  message,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  title,
}: QueryErrorDialogProps) {
  const [isOpen, setOpen] = useState(Boolean(message));

  if (!message) {
    return null;
  }

  return (
    <ActionDialog
      description={description ?? message}
      onClose={() => setOpen(false)}
      open={isOpen}
      primaryAction={
        primaryHref
          ? { href: primaryHref, label: primaryLabel }
          : { label: primaryLabel, onClick: () => setOpen(false) }
      }
      secondaryAction={
        secondaryHref && secondaryLabel
          ? { href: secondaryHref, label: secondaryLabel }
          : undefined
      }
      title={title}
    />
  );
}
