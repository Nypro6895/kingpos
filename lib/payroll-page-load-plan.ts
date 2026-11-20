/** Optional reads follow the visible tab in both web and the installed iOS page. */
export function payrollPageLoadPlan(tab: string | undefined, owner: boolean) {
  return {
    includeAnalytics: tab === "analytics",
    includeShopMoney: owner && (tab === undefined || ["shop", "gifts", "rewards", "discounts"].includes(tab)),
    taxPlugin: owner && tab === "tax",
    downloadPlugin: tab === "tools" || tab === "download",
  };
}
