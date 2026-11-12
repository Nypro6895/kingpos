# Mixed POST read/mutation audit — 2026-11-11

Read-only source audit against this QA worktree. No product code, DB, grants,
financial rules, or credentials were changed for this audit.

The HTTP fetch observer in `components/session-expiry-prompt.tsx` treats a
successful POST as a data change unless `lib/experience-mutations.ts` classifies
it as passive. It then invalidates scoped resources and emits
`reylumi:experience-mutation`. A read can therefore invalidate an unrelated
in-flight history read even if that history response was HTTP 200.

`HistoryDetailsDrawer` mounts `BookingRewardPending`, whose `useRewardWallet`
calls `/api/rewards` with `scope=personal, op=wallet`. Visit gift-card polling
also calls the mixed rewards endpoint with `scope=personal, op=gift-load`.

## Audited passive operations

| Endpoint | Exact scope / op | Authority and read semantics |
| --- | --- | --- |
| `/api/rewards` | personal / wallet | Latest `reward_personal` wallet branch returns SELECT projections before entering visit commands. `reward_view` and `reward_booking_pending` are STABLE read projections. |
| `/api/rewards` | personal / gift-load | Route calls `reward_visit_gifts` with `p_card=null`; owned active visit and current session/card SELECTs only. Approval branch is skipped. |
| `/api/rewards` | owner / load | Latest `reward_owner` SELECTs program/metrics without entering save/preview validation branch; appended invitations call has no `p_accept`, hence no participation INSERT. |
| `/api/rewards` | owner / preview | Validates draft/readiness, then returns before save INSERT/UPDATE. Appended invitation projection is also read-only. |
| `/api/rewards` | owner / report | `reward_owner_report` is STABLE, aggregates canonical ledgers/tickets only. |
| `/api/rewards` | admin / load | Permission checked; SELECT-only branch of `reward_admin`; `save` is distinct. |
| `/api/gift-cards` | owner / read | Permission checked; returns settings/cards/ledger/stats without entering install/design/lock/unlock branches. |
| `/api/gift-cards` | wallet / list | Authenticated owner's card SELECTs only, returns before other commands. |
| `/api/gift-cards` | wallet / history | Locks/selects owned/controlled card, then SELECTs ledger; no DML. Row locks do not imply a data mutation. |
| `/api/gift-cards` | public / read | Validates bearer card and SELECTs its view; no DML (despite row lock). |
| `/api/gift-cards` | public / mobile | Validates current session, returns its view before invoking session commands. |
| `/api/gift-cards` | online / catalog | `gift_card_catalog` is a STABLE SQL SELECT. |
| `/api/gift-cards` | pos / wallet | Requires valid POS/salon/session, SELECTs customer's owned available cards. No `sync` branch. |
| `/api/gift-cards` | pos / read | Requires POS/salon/session; delegates to `gift_card_session_command` read branch which returns immediately after row SELECT, before DML. |

## Operations that must remain mutations

- Rewards personal/display/pos `load` is **not** a pure read. The current
  `reward_request_command` calls `reward_join` before its load return; a new
  customer may gain a membership and welcome ledger entry.
- Rewards POS `quote` can join a customer and update quote, consent, revision,
  and request state. `owner-cart`, `owner-submit`, `relay`, request, suggest,
  confirm, cancel, gift-approve, owner save/accept, and admin save are mutations.
- Gift `display/read` may create `gift_card_sessions` before checking `p_op`.
  Do not exempt it based only on the word "read".
- Gift online `status` calls `syncGiftOnline`, which can finalize an online
  payment/order/card. It is not equivalent to catalog lookup.
- Gift public `receive` changes delivery `collected`; `scan`, `open`, `buy`,
  `code`, and transfer change state.
- Gift wallet present creates presentation credentials; claim/approve/transfer
  mutate ownership, approvals, generations, credentials or ledger.
- Gift POS sync creates/updates sessions and applies reward quote logic;
  submit/collect/amount/buy/cancel/wallet_request and owner install/design/
  lock/unlock/connect/void-sale remain mutations.
- Unknown scope/op combinations remain conservative mutations after success;
  do not exempt entire mixed endpoints.

## Source checked

- `app/api/rewards/route.ts`, `app/api/gift-cards/route.ts`
- `lib/customer-history-client.ts`
- `components/rewardlumi/booking-reward-pending.tsx`
- `components/rewardlumi/use-reward-wallet.ts`
- `components/rewardlumi/visit-gift-cards.tsx`
- `supabase/migrations/20261105021000_reward_late_identity_reconciliation.sql`
- `supabase/migrations/20261104231700_booking_reward_pending.sql`
- `supabase/migrations/20261102110000_reward_practical_acceptance.sql`
- `supabase/migrations/20261030065000_reward_authority.sql`
- `supabase/migrations/20261030060000_rewardlumi.sql`
- `supabase/migrations/20261030061000_reward_gift_unified.sql`
- `supabase/migrations/20261030062000_reward_discovery_admin.sql`
- `supabase/migrations/20261030066000_reward_reporting.sql`
- `supabase/migrations/20261030050000_digital_gift_cards.sql`
- `supabase/migrations/20261030050001_gift_card_online.sql`
- `supabase/migrations/20261030050003_gift_card_pos_semantics.sql`
- `supabase/migrations/20261030050004_gift_card_settlement_helpers.sql`

Recommended implementation is an authoritative server response hint for audited
successful read operations, recognized by the common classifier. Preserve
explicit data/scope hints, real command invalidation, and all authorization.
Do not accept a caller-provided header as proof that a mutation was a read.
