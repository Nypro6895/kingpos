type AuthFragmentLocation = Pick<Location, "pathname" | "search" | "hash">;
type AuthFragmentHistory = Pick<History, "state" | "replaceState">;

// Email confirmation uses password login, not tokens from the URL. Remove only
// recognizable implicit Auth credentials, retaining the exact return query.
export function clearImplicitAuthFragment(
  location: AuthFragmentLocation,
  history: AuthFragmentHistory,
) {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (!fragment.has("access_token") && !fragment.has("refresh_token")) return false;
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return true;
}
