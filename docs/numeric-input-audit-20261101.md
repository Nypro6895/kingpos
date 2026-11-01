# Numeric input editing audit — 2026-11-01

Source baseline: `25a4e32bd99a8e533b871be99715e8a79cca2bf3`
(`codex/combined-financial-release-20261101`). This source contains the Expenses
and Bonus screens reported by the owner; `main` predates the Expenses feature.

## Scope and finding

A TypeScript JSX scan of all 705 TSX files in `app/` and `components/` found
1,054 native input declarations, including hidden, checkbox, authentication,
search, date and text fields. There are 90 declarations with a literal number
type or decimal input mode, plus 28 declarations with dynamic type/input mode.
These are source declarations, not counts of rendered fields: loops and reusable
`Field` components create additional inputs at runtime.

Expenses initializes `amount` to `0.00`; Bonus initializes its controlled string
from `bonusAmount.toFixed(2)`. Native typing appends at the current caret position,
so typing 55 can produce `0.0055`. A number of other financial editors initialize
zero the same way. Selecting text on focus alone is unreliable as a shared fix:
click/tap can reposition the caret, and number inputs do not expose a text caret.

## Shared behavior

The application root mounts `NumericInputBehavior` once. It delegates numeric
editing through native `beforeinput`, so it also covers retained screens,
conditionally opened forms, dialogs, Server Component forms, and app-local views.

- The first insertion in a focused number/decimal editor replaces a literal zero
  such as `0`, `0.00`, or `-0.00` before the browser inserts the new text.
- Only a real edit changes the value. Focusing, moving the caret, or leaving an
  untouched field does not send a change event or start autosave.
- Further keystrokes in that focus session preserve the user's draft, including
  `0.05`, `0.55`, decimal points and fractional zeroes. Precision remains the
  responsibility of each form's existing validator.
- Existing nonzero amounts retain ordinary caret and selection editing.
- Native `type`, `min`, `max`, `step`, `required`, React handlers and form payloads
  remain intact. Text identifiers, phone numbers, PINs, codes, account/routing
  numbers and check numbers retain their leading zeroes.
- The supplemental keyboard emits the same cancellable `beforeinput` event
  before it reads the value/caret, and decimal inputs open its number layout.
  The helper remembers the numeric field while this keyboard suppresses the
  native keyboard with `inputmode=none`.

## Reviewed areas

| Area | Numeric editors covered |
| --- | --- |
| Reports / Shop Money | Expenses add/edit and Quick Expense; collection Cash/Card/Other; opening money, tax reserve, rent and card fees |
| Daily Closing | Owner and Portable Cash/Card/Other and tip inputs |
| Payroll | Bonus autosave; inline pay settings; daily gross/tip; run inputs and recorded cash/check amounts |
| POS / tickets | Checkout adjustments, tip splits, closed ticket corrections, app-local ticket detail |
| Services / bookings | Service prices/durations, add-on prices, booking prices/durations, profile custom price/duration |
| Settings | Shared numeric Field renderers, POS thresholds/tip suggestions, team/payroll and salon settings |
| Gift / rewards / deposits | Gift purchase/application amounts, reward settings, deposit amounts/percentages |
| Check Writer / campaigns / admin | Amounts, number fields and limits; routing/account/check identifiers excluded |

Owner POS uses its own keypad replacement state (`replaceAmount`) and selects
its `inputmode=none` amount/tip/discount drafts on focus. It retains that existing
mechanism. Add-on duration uses a text draft with select-on-focus and explicit
integer validation; add-on price additionally receives the decimal behavior.

## Verification and publication

`tests/numeric-input-editing.test.mjs` runs browser regressions against controlled
and uncontrolled native inputs, the real Expenses form, real Bonus autosave
component and supplemental keyboard. Service writes are isolated fixtures;
no production financial records are created.

The tests exercise typing, real clipboard paste, fractional zeroes, deletion,
dynamic reopen, untouched focus, one change per character, nonzero caret editing,
identifier preservation, native range/step validation, expense request payloads
and Bonus autosave payloads.

This is a web change compatible with the existing WKWebView. No Swift, bundled
native assets or bridge contracts change. Implementation does not publish under
`docs/release-policy.txt`; integrate this patch into the exact production source
and perform the normal guarded release when publication is requested.

Browser checks use Chromium at a 390px touch viewport. Physical iPhone/Safari
verification remains necessary for an actual iOS keyboard confirmation.

Validation results:

- Production build and TypeScript: passed, including 268 generated pages and the
  offline asset manifest (491 assets).
- New numeric input regressions: 6 passed.
- Existing device keyboard regressions: 2 passed; existing financial change
  presentation and Shop Money wiring checks: 12 passed.
- Existing Check Writer UI: passed using the installed Chromium executable via
  a temporary runtime override; its original runner requires a Chrome channel
  absent on this machine. No test source was altered.
- Two existing `portable-report-today` tests fail independently of this patch:
  an obsolete save-scope assertion and missing fixture exports (`useSearchParams`
  and `getPortableReportInputHistory`). Their tested application modules are
  unchanged here, and their fixtures do not mount the new input behavior.
- `payroll-input-formula-regression` cannot start: it depends on historical
  commit `6115a30`, which is absent locally and returns 422 from GitHub. Payroll
  calculation code is unchanged by this patch.
