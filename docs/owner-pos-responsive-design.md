# Owner POS responsive design

Desktop keeps the receipt, staff/service choices and keypad visible together. Mobile uses local steps (staff → service → amount), with one compact ticket summary and a review dialog. Selecting a tile advances immediately; Back preserves the entry. Add another appends the entry to the same cart identity; only Submit queues the whole ticket.

Existing cart storage, saved tickets, device locking, background uploads and payment behavior are retained. Step is optional in saved carts so older drafts still open. Staff eligibility is checked again at submission. An empty optional catalog skips directly to amount entry.

Settings use one surface per group, two launch actions together, compact toggle rows, collapsible permissions, smaller image previews and shorter copy. Group-level save/conflict handling is retained.

Design references:
- Shopify POS smart-grid guidance prioritizes frequently used tasks and product tiles: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/customize-pos/smart-grid-management/edit
- Square item-detail settings balance faster entry with explicit selection: https://squareup.com/help/us/en/article/8634-customize-item-details-settings

The staff/service/amount sequence is a KingPOS-specific design decision, not a claim about either vendor's workflow. Long choice lists scroll inside their panel; the checkout actions stay in the workspace.

## Compact screens
At phone heights up to 700 px, customer/tip/discount actions are available from View ticket. This reserves space for the keypad and Submit. Amount entry uses the in-app keypad instead of opening a second system keyboard. Settings pages retain normal scrolling; only the Owner checkout screen is fixed.

## Verification
- Browser tests cover one device writer, draft persistence, saved-ticket restore, queue retry after a lost response, and one operation for multiple staff/service entries.
- Real server tests cover Owner checkout, grouped Settings conflict resolution, distinct Portable display drafts, and Report availability.
- Visual inspection covers phone, desktop and Settings interiors; the small-screen test checks keypad/action separation in addition to Submit visibility.

Primary implementation: app/pos/owner-pos-client.tsx, app/(app)/pos/settings/page.tsx, app/pos/settings/desktop-download-panel.tsx, app/pos/settings/customer-display-install-panel.tsx, app/globals.css.

Final run note: production build, TypeScript, targeted lint, isolated Owner browser tests, actual Owner receipt submission and Settings conflict checks passed. The last broad end-to-end run stopped at Portable initialization: the server reported a Supabase Check-in statement timeout and the Portable amount panel did not open within 60 seconds. The same integration had passed before the final CSS-only spacing adjustment. This is an outstanding server-data availability check, not a verified all-green integration result.
