"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";

export function WorkspaceLink(props: ComponentProps<typeof Link>) {
  const __vt = useWorkspaceTranslation();

  const t = useWorkspaceTranslation();
  return <Link {...props} title={__vt(t(props.title))} aria-label={__vt(t(props["aria-label"]))} />;
}
