type StartupInteraction = { route: string; viewerId: string | null; query?: string; focused?: boolean; gps?: boolean; at: number };
declare global { interface Window { __reylumiStartupSearch?: { query: string; focused?: boolean; at: number; route: string } } }
let interaction: StartupInteraction | null = null;

function currentRoute() {
  const query = new URLSearchParams(window.location.search); query.sort();
  return window.location.pathname + (query.size ? `?${query}` : "");
}
// A short-lived in-memory handoff keeps a draft while the streamed first batch
// replaces the startup toolbar. It is never persisted or shared across viewers.
export function rememberExploreStartupInteraction(viewerId: string | null, value: { query?: string; focused?: boolean; gps?: boolean }) {
  interaction = { ...readExploreStartupInteraction(viewerId), ...value, viewerId, route: currentRoute(), at: Date.now() };
}
export function readExploreStartupInteraction(viewerId: string | null) {
  if (typeof window === "undefined") return null;
  if (interaction && interaction.viewerId === viewerId && interaction.route === currentRoute() && Date.now() - interaction.at <= 60_000) return interaction;
  const shell = window.__reylumiStartupSearch;
  return shell && shell.route === currentRoute() && Date.now() - shell.at <= 60_000 && shell.at <= Date.now()
    ? { ...shell, viewerId } : null;
}
export function clearExploreStartupInteraction() { interaction = null; if (typeof window !== "undefined") delete window.__reylumiStartupSearch; }
