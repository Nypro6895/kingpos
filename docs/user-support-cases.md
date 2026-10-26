# User support

Help & support is available in Settings, every role's More menu, desktop account menus and the legal footer. Work screens expose a compact More menu with a contextual shortcut; there is no global floating report button. `/more/reports` redirects to the support center.

`/support` lists the signed-in user's requests and offers intake for functionality, data/calculations/payroll, booking, recorded tickets, review disputes, account, salon access, moderation appeals and other issues. No payment/refund processing is implied. Context contains the screen path and optional expected/observed values, not unrestricted background records or screenshots.

Requests create `platform_reports` with source `user_support`. Conversation messages and private evidence are distinct from internal admin notes. Admin replies require `admin.reports.update`; reading another user's conversation requires `admin.reports.read`. Existing assignment/priority/resolution workflow remains in Support Cases. Replies and resolution changes notify the requester. A reply can explicitly reopen a resolved case. Conversation refresh runs every 30 seconds while visible.

Guest contact creates one `guest_support` case linked to the existing Inbox thread. A signed, HttpOnly, SameSite browser cookie grants access to `/support/guest/<threadId>` for 30 days. A case ID alone grants no access. Guest follow-up and evidence work in the original browser; changing browsers requires contacting support. Guest conversation endpoints are service-role only and invoked after cookie verification. Existing email reply functionality remains available from the linked Inbox. Incoming external email is not automatically imported into the in-app conversation.

Evidence supports PNG/JPEG/WebP/PDF, up to 5 MB each and 20 files per case. Storage is private; signed links expire after 10 minutes. Uploads check case authorization, type signatures and size; failed metadata writes remove the uploaded object.

Post-content reports remain in Post Safety and are excluded from Support Cases before pagination. Creating a support request never hides a post, changes payroll data or suspends an account. Moderation appeals are support conversations requiring a team decision.

Verification: `node --test tests/support-cases.integration.test.mjs` and `node artifacts/support-cases-ui-qa.cjs`.
