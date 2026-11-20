import type { CurrentWorkspaceOption } from "@/lib/current-context";
export function taxWorkspaceOption(): CurrentWorkspaceOption {
  return {
    id: "tax",
    type: "tax",
    label: "Tax",
    roleCode: "tax",
    roleLabel: "Tax professional",
    defaultHref: "/tax",
    description: "Tax workspace",
    accountId: null,
    accountName: null,
    avatarUrl: null,
    businessId: null,
    businessMode: null,
    businessName: null,
    salonCount: null,
    salonId: null,
    salonMode: null,
    salonName: null,
    primaryAction: { id: "tax", label: "Open Tax", href: "/tax" },
    secondaryAction: null,
    quickActions: [],
    menuActions: [],
  };
}
