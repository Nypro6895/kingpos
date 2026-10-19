# Auth / workspace lifecycle repair following build39 audit

This work starts from `fe233c9c3244f762914c2d7a9944795f40925ccc`, whose product source is the shipped build39 commit `62f22d20c5fe9e048a679f9ba6c648d2115cd632`. It does not incorporate the unrelated dirty root checkout. No production or TestFlight release is authorized by this implementation task.

## Scope of this first stage

- Add bounded local native/JS troubleshooting records in Release as well as Debug. Export requires an explicit user action and the iOS share sheet. Native revalidates the exported JavaScript records; no URLs, account IDs, credentials, cookies, free-form errors or business payloads are accepted.
- Distinguish explicit server denial, stale request cancellation, expired admission and internal reset. Keep page admission fail-closed and retain the original mutation authority checks.
- Repair the demonstrated late-cookie-response race without ignoring authoritative cookies or resetting a newer internally committed cookie jar. External unknown authority changes must still invalidate access.
- Align successful online context delivery with the existing JS admission rule when display-lease issuance is temporarily unavailable. Online display does not create a durable offline lease or authorize commands.
- Give Supabase safe GETs one bounded retry owner and propagate the request's abort signal into their transport. Transactional POST/PATCH/DELETE operations are never automatically replayed or interpreted as rolled back by a display timeout.

## Evidence boundaries

The audit demonstrated these defects using actual product server modules and the Supabase SDK, with controlled backend responses. The new native regression tests exercise Swift transport code with controlled HTTP/cookie responses. A simulator result is not evidence that the exact build39 failure on the owner's physical iPhone has been reproduced.

The current build39 has no usable Release export of this diagnostic buffer. The new diagnostic surface requires a later native update before an owner can collect it on an iPhone. There is no claim that changing local source updates an installed app.

## Next physical-device check

After a separately authorized native release, retain the app's existing account/cache state. Reproduce cold opening, idle/foreground, Staff to Owner, weak network and a normal token renewal. If a failure occurs, use **Save diagnostic report** on the failure screen. For slow or recovered flows, the same action is available at the bottom of Help. Choose Save to Files and attach the JSON; saving does not sign out, erase cache or send a report automatically.

Inspect native context/HTTP status and grantStatus, cookie commit/stale/mismatch reasons, scope reset reasons, cancellation and JS admission reasons. Compare request timing with the retained visible sections. Never request or export raw cookies or tokens.

## Deliberately separate later work

Shared Today bootstrap data, common entity caches across Book/Staff/Profile, missing feature-specific API adapters and broader payload/asset optimization remain distinct audit findings. Do not combine them with an unobserved physical-device failure or bypass security to reduce calls. Changes to these areas require their own regressions and measurement after the Auth/transport boundary is verified.

Final validation and exact file hashes are recorded separately when this implementation revision is frozen. No fix claim for the physical iPhone is made here.
