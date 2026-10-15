export function openDashboardRecord(href: string, tab = "overview") {
  if (href.startsWith("/admin/audit?")) {
    const params = new URLSearchParams(href.split("?")[1]);
    const type = params.get("targetType"), id = params.get("targetId");
    if (type === "location" && id && /^[0-9a-f-]{36}$/i.test(id)) return openDashboardRecord(`/admin/locations/${id}`, "activity");
  }
  const match = /^\/admin\/(users|locations|businesses)\/([0-9a-f-]{36})(?:[?#]|$)/i.exec(href);
  if (!match || typeof window === "undefined" || location.pathname !== "/admin") return false;
  window.dispatchEvent(new CustomEvent("admin:record", { detail: { kind: match[1] === "users" ? "user" : match[1] === "locations" ? "location" : "business", id: match[2], tab } }));
  return true;
}
