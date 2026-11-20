import { invalidateExperienceResources } from "@/lib/experience-resource-cache";

// Cached Market views refresh through their authorized resource endpoint. A
// standalone product or payment-return page still needs its server props read.
export function refreshMarketExperience({ scope, refresh, fallback, allResources = false }: {
  scope?: string;
  refresh?: () => void;
  fallback: () => void;
  allResources?: boolean;
}) {
  invalidateExperienceResources(allResources ? { scope } : { scope, tags: ["market", "catalog", "settings"] });
  window.dispatchEvent(new CustomEvent("reylumi:market-changed", { detail: { scope } }));
  if (refresh) refresh();
  else fallback();
}
