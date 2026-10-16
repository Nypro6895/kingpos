export const APP_LOCAL_EXPLORE_PATHS = ["/explore"] as const;
export const APP_LOCAL_EXPLORE_READS = [
  { name: "page.explore", argumentKeys: ["query"], retain: true },
  { name: "page.explore-extras", argumentKeys: ["query"], retain: true },
  { name: "page.explore-feed", argumentKeys: ["query"], retain: true },
  { name: "http.explore.search", path: "/api/explore/search", method: "POST", argumentKeys: ["input"], retain: false },
  { name: "http.explore.feed-page", path: "/api/explore/feed", method: "POST", mode: "page", argumentKeys: ["input"], retain: false },
  { name: "http.explore.feed-updates", path: "/api/explore/feed", method: "POST", mode: "updates", argumentKeys: ["input"], retain: false },
  { name: "http.explore.feed-validate", path: "/api/explore/feed", method: "POST", mode: "validate", argumentKeys: ["input"], retain: false },
  { name: "http.explore.area", path: "/api/explore/area", method: "POST", argumentKeys: ["input"], retain: false },
  { name: "http.explore.suggestions", path: "/api/explore/suggestions", method: "GET", argumentKeys: ["q", "location", "category"], retain: false },
] as const;
export const APP_LOCAL_EXPLORE_COMMANDS = [
  { name: "http.explore.feed-events", path: "/api/explore/feed", method: "POST", mode: "events", argumentKeys: ["input"], replay: "never" },
] as const;
export const APP_LOCAL_EXPLORE_QUERY_KEYS = ["browse", "category", "location", "page", "q", "scope", "sort", "type", "locationSource"] as const;
