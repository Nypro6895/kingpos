"use client";

import { useWorkspaceTranslation } from "@/components/workspace-language";
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
  const __vt = useWorkspaceTranslation();

  const [isOpen, setOpen] = useState(Boolean(message));

  if (!message) {
    return null;
  }

  return (
    <ActionDialog
      description={__vt(description ?? message)}
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
      title={__vt(title)}
    />
  );
}
