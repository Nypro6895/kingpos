# Gift wallet scrolling and POS delivery recovery

Implementation source: `fix/gift-wallet-recovery-20261113`, based on
`cc9041ae1d6d5cfc6f2ba16d2b9eb4d5afecc375` from the pending Gift Ticket work.
This revision requires `gift-ticket-unified-20261113`, its QA follow-up and
their existing checkout/session lifecycle dependencies. It is not a deployment.

## Behavior

- Read-only gift artwork accepts normal page scrolling from the background,
  text and logo. Only the editable designer captures artwork gestures.
- Wallet cards use a compact saved-design thumbnail, clear balance, primary
  Use action and secondary Transfer/History. Checkout code, history and
  transfer each open a focused dialog instead of appending off-screen content.
  The temporary checkout code/PIN keeps its existing one-use, two-minute rule.
- Transfer first selects Share, Save image or Email, explains previous-code
  invalidation, and waits for an explicit create-and-send action. It retains
  the existing wallet/public transfer protocol and request identities through
  uncertain responses. A confirmed transfer stays available in this mounted
  page if native sharing is canceled or fails; a new outgoing action still
  replaces its code. No bearer credential is persisted to browser storage.
- An accepted Buy selection atomically dismisses both paired editors while
  preserving its pending purchase amount for payment selection and Submit.
  A rejected Buy keeps the editor open. The inherited lifecycle changes give
  the next customer a fresh Buy/Use session rather than reusing a completed one.
- Closed Gift sale rows offer **Show / send gift card** in Owner and Portable
  Tickets. The privileged read recovers the original uncollected card after
  the short checkout screen/session expires. It does not issue another card,
  rotate its credentials, change its value or ownership, or reopen an old
  customer-display prompt during the next checkout.
- The delivery dialog provides QR, Copy and Share directly. Staff sharing
  does not visit the public receive page and prematurely mark the customer
  as having received the card. Actual public receipt still ends recovery.
- Collected, claimed, transferred, voided, locked or unavailable cards return
  a status without a bearer credential. The read requires the same salon,
  exact Ticket/sale pair and existing Owner/Portable POS authority. Locked
  Portable sessions cannot fall back to a signed-in Owner session.
- Generic Ticket/financial list payloads do not gain credentials. All delivery
  responses are uncached. Existing financial, service, staff and payroll rules
  are unchanged.

## Wallet presentation preview

The compact direction was shown before implementation. The separate interactive
proposal at
`C:\Reylumi\artifacts\gift-wallet-solution-20261113\gift-wallet-proposal.html`
shows compact artwork, a primary Use action, secondary Transfer/History, and a
focused Transfer confirmation. Its QR is a labeled placeholder. Every explicit
outgoing transfer retains the existing previous-code replacement policy.
There are no actual transfer, clipboard, email or sharing side effects in the
proposal. This proposal is not registered as the working-source Live Preview.

## Validation and local preview

Evidence is under `artifacts/gift-wallet-recovery/`. Final verification results
and exact frozen source hashes are recorded in the completion journal.
The actual Next Portable/Owner routes, API and complete isolated database passed
eleven journeys, including anonymous Gift-only, mixed service/Gift, second-customer
Buy/Use and expired delivery recovery from both Ticket readers while the next
checkout stayed open. Staff Copy/Share leaves the prior card uncollected and
creates no additional card, sale or ledger entry.
Wallet actions, paid return, touch scrolling and designer dragging pass all nine
runtime tests (`wallet-runtime.log`). Financial/Ticket/shared-POS/public-link
regressions pass 14 checks (`regressions.log`). The paired lifecycle, delivery
API, delivery dialog and full-schema permission/replay suites also pass.
The final combined webpack/TypeScript build and offline asset budget pass
(`build-combined.log`, `offline-combined.log`); scoped ESLint has no errors.
Checks use real components with synthetic data and the complete schema in
network-disabled local Supabase fixtures. They do not establish hosted,
installed Windows, Safari, native iOS or physical-device acceptance.

The optional viewer was already running. This chat registered the exact source
server at `http://127.0.0.1:6145/gift-cards`, using its own Next development
output and HMR. The isolated preview has no production backend or signed-in
Wallet account; full Wallet data is available only in the synthetic component
tests. The viewer was not launched or reopened by this task.

## Integration

Apply the new compatible migration and web components together with their
pending dependencies onto the current production source, then rerun the normal
release checks. No hosted schema, real transaction, notification dispatch,
production deployment, Electron host, Swift source or bridge ABI was changed.
Shared web/offline inclusion still requires the ordinary Windows packaging and
native bundle assessment at release time.

## Secondary action hierarchy follow-up

The owner's follow-up keeps filled controls for Use/Continue transfer and the
explicit transfer confirmation. Transfer, History, My wallet, close/dismiss,
Share and Copy use unboxed clickable text with visible keyboard focus and
44px touch targets. Transfer method choices are unboxed text with an underline
for the selected method. Continue transfer replaces the duplicate secondary
Transfer action; focus returns to that retained primary action after dismissal.
The dedicated Ticket delivery dialog puts Share/Copy on one line and treats
Done as secondary. Handlers, permissions, credential rotation and financial
behavior are unchanged.

The existing Wallet action and Ticket delivery runtime suites pass all eight
checks in this follow-up. Computed styles, focus and bounds were inspected at
320/390px; both Share/Copy targets remain 44px high with no horizontal overflow.
Scoped ESLint and whitespace checks pass. Evidence is under
`artifacts/gift-action-hierarchy/`. The real local HMR server was verified to
serve this source's current secondary-action styles and registered again for
this chat. This presentation-only follow-up does not publish the application.
