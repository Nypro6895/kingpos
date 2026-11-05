# HTTPS financial QA design boundary — not enabled

Current commerce.ts/service() and stripe-test.ts/testPaymentConfig() accept only
isolated loopback Supabase/origin and test-mode keys. This milestone does not
modify, bypass or add an environment override to those guards.

A future separately reviewed HTTPS financial configuration would need exact,
source-reviewed QA project/origin/account allowlists tied to the approved QA
resource IDs; test-only provider credentials and platform-account verification;
private server persistence; webhook signature/account/event/object binding;
original quote/intent/idempotency reconciliation and explicit financial-admin
permission. No hostname suffix wildcard, production key/origin fallback or
browser-supplied account/tenant may activate it. Missing/mismatched config must
fail before a provider request. Phase0 remains off until the owner approves
provider test usage and unresolved commercial/financial decisions are separated
from synthetic test fixtures.

That runtime validation patch and its HTTPS/provider acceptance are **not yet
implemented**. The hosted QR Auth/config validation is not financial authorization.
Do not create keys, enable commerce or adjust commission/refund/dispute/tax/payout
policy to make staging pass. This document is design input only.
