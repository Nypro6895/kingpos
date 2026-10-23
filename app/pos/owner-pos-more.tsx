"use client";

import { RoleMoreContent } from "@/components/role-more-content";
import { OwnerPosNavigation } from "./owner-pos-tabs";

export function OwnerPosMore() {
  return <div className="owner-pos-document"><OwnerPosNavigation active="more" /><main className="mx-auto max-w-3xl p-4"><RoleMoreContent roleKind="owner" activeItemIds={[]} workspace="pos" onNavigate={() => {}} /></main></div>;
}
