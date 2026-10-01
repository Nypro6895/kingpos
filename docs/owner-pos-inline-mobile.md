# Owner POS inline mobile layout

The owner desktop checkout uses a three-column receipt, staff/service board and keypad layout. The checkout hides the surrounding owner navigation to use the available screen; Settings restores the regular owner workspace navigation.

Mobile keeps staff/service selection as steps, then shows ticket entries immediately above the keypad. Selecting an entry routes keypad input to that entry; the first digit replaces its previous amount. The amount is displayed and editable in its row, with no separate amount panel. Settings and Back to POS are icon links. The footer retains the total, Add and Submit.

## Data boundaries

- A ticket still belongs to one customer. Multiple entries are services/staff within that ticket, not separate customer accounts.
- Optional `activeLineId` is compatible with existing local carts and saved tickets.
- Editing an existing entry updates its amount and amount parts in place; it does not add another line.
- Submit validates every entry, retains staff eligibility checks and uses the existing durable operation queue and cart identity.
- Responsive desktop/mobile transfer retains the existing single-writer lock.
- No payment authorization, database schema or Windows installer changes.

## Validation

- Owner browser tests: offline submit, reopen, saved ticket restore, responsive handoff, lost response retry without duplicate sale, edit existing entry and preserve its value after reload, multi-entry submit, 320px mobile fit.
- TypeScript and targeted lint passed.
- Final production build passed, including the keypad height adjustment. The mobile browser test was rerun successfully after that adjustment.
- Real isolated-account integration passed: owner checkout and receipt in database, simultaneous duplicate requests, settings conflict handling, independent portable display drafts and report loading. Test data was cleaned up.

Main files: `app/pos/owner-pos-client.tsx`, `app/pos/owner-pos-tabs.tsx`, `app/navigation-shell.tsx`, `app/globals.css`.

## Mobile tip and discount entry

Tip and Discount select the shared keypad target on mobile, without opening a dialog. The active button and adjustment row are highlighted; the receipt shows Tip as a positive amount and Discount with a minus sign. Selecting a service row restores service amount entry. Adjustment values and the input target persist with the cart; the receipt operation still carries positive `tipAmount` and `discountValue` fields. Desktop retains its adjustment dialogs.

Browser tests verify both adjustments, no open dialog, active button state, unchanged service amounts, total calculation, reload recovery, small-screen fit and queued receipt payload values.
