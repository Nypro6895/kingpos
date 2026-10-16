import type { ComponentProps } from "react";
import type { CustomerDisplayClient } from "@/app/pos/customer-display/customer-display-client";
import type { AppLocalContext } from "./app-local-host";
import type { AppLocalPortableContext } from "./app-local-portable-metadata";
import { getPublicAppOrigin } from "./public-app-url";

export type AppLocalDisplayData = ComponentProps<typeof CustomerDisplayClient>;
export type AppLocalDisplaySettingsData = Omit<AppLocalDisplayData, "token"> & { draftId: string };
export type AppLocalDisplayContext = (AppLocalContext | AppLocalPortableContext) & { displayAuthority: { kind: "owner" | "portable" | "public" } };
export const APP_LOCAL_DISPLAY_ROUTES = ["/pos/customer-display", "/pos/customer-display/setup"] as const;
export const APP_LOCAL_DISPLAY_READS = {
  "owner.customer-display": { argumentKeys: [], access: "scoped", retention: "none", semantics: "original-ephemeral-draft-initialization" },
  "portable.customer-display-settings": { argumentKeys: [], access: "scoped", retention: "scoped", semantics: "original-paired-device-read" },
  "display.http.settings": { argumentKeys: ["token"], access: "scoped", retention: "none", semantics: "original-public-capability-read" },
  "display.http.entry": { argumentKeys: ["token"], access: "scoped", retention: "none", semantics: "original-public-capability-read" },
} as const;
export const APP_LOCAL_DISPLAY_HTTP_READS = [
  { name: "display.http.settings", path: "/api/pos/customer-display/settings", argumentKeys: ["token"] },
  { name: "display.http.entry", path: "/api/service-relay/entry", argumentKeys: ["token"] },
] as const;
/** The same original public token functions; all dispatches additionally match the fresh display authority. */
export const APP_LOCAL_DISPLAY_ACTIONS = [
  ...["confirmCustomerDisplayLiveDraftTip", "findLiveDraftCustomerByPhone", "createLiveDraftCustomer", "getCustomerDisplayLiveDraftTipOptions", "resetCustomerDisplayCompletedDraft", "saveCustomerDisplayRequestedServices", "searchCustomerDisplayLiveDraftCustomers", "submitCustomerDisplayPhone"].map(name => ({ module: "app/pos/actions.ts", export: name, tokenArgument: "input" as const })),
  { module: "app/pos/actions.ts", export: "getPosLiveDraft", tokenArgument: "first" as const },
  { module: "app/pos/checkin-receipt-actions.ts", export: "issueCheckinReceipt", tokenArgument: "first" as const },
  { module: "app/service-relay/actions.ts", export: "issueServiceRelayPass", tokenArgument: "first" as const },
] as const;
/** Exact public defaults from the existing POS settings projection; no private customer or salon data. */
export const APP_LOCAL_DISPLAY_DEFAULTS: AppLocalDisplayData["settings"] = {
  appDownloadUrl: getPublicAppOrigin(), customerBackgroundImageUrl: null, customerLeftAdImageUrl: null, customerLeftAdText: "Stay connected with our beauty community",
  customerPromoBody: "Thank you for choosing us today!", customerPromoTitle: "Welcome back,", customerRightAdImageUrl: null,
  customerRightAdText: "Earn points & rewards. Exclusive member offers. Easy booking & reminders. Track your favorite services.",
  customerShowBarcode: true, customerShowCustomerName: true, customerShowReceiptStatus: true, customerShowSalonName: true, customerShowServiceName: true, customerShowStaffName: true,
  salonLogoUrl: null, salonName: null, tipSuggestions: [5, 10, 15, 20],
};
