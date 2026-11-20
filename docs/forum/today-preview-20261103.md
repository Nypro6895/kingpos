# Today forum preview — combined-release queue

Owner Today now displays up to two latest non-deleted forum posts after Quick access and before Market. Each link shows a title and one short line of body text and opens /forum?topic=<id>. Staff Today is unchanged. Links do not prefetch the full forum.

Optional content loads independently through GET /api/forum/latest with private/no-store responses, a 6-second client timeout, cancellation on unmount, and focus/visibility refresh at most once per minute. There is no polling or persisted forum-content cache. Empty/unavailable data hides the section without blocking Today. Existing WorkspaceLink preserves app navigation.

Apply additive migration 20261104011000_today_forum_preview.sql after the queued forum migrations. It adds latest_preview to the existing authorized forum_read RPC, returning only id/title/160-character whitespace-normalized excerpt/created_at, limited to two posts ordered by creation time regardless of pinning. Existing actor authorization remains in place; no new public data access.

Installed iOS fetch support is included as scoped non-retained http.shell.forum-latest in the existing shell transport and registry. A new native bundle/registry must be built from the latest uploaded native baseline during the combined release; these sources do not change the installed build by themselves.

Validation: 13 database/native-transport/existing shell regressions pass, plus TypeScript. Evidence: artifacts/today-forum/regression.txt and typecheck-complete.txt. This small addition has not had a separate full production build, authenticated live check or physical iPhone acceptance; run those against the combined release source. Not deployed. Owner requested the forum changes stay in the combined queue.
