# OpenAI photo processing — consented caller wiring, 18/11/2026

## Current update — source consent and live probe completed

The owner manually provided the dedicated local configuration outside Git, the actual adapter passed one authorized synthetic-image probe, and the approved Beauty/Salon permission checkbox is implemented with scoped draft/retry guards. See [provider acceptance](openai-photo-live-acceptance-20261118.md), [approved UI acceptance](ios-approved-ui-implementation-20261118.md) and [current completion work](ios-store-completion-20261118.md). The prior key/consent-UI blockers below are historical. Hosted configuration, combined integration, operational limitations and final binary/device acceptance remain separate gates. No new credential setup is requested or performed by this update.

## Original wiring patch status before that acceptance

**LOCAL SOURCE CANDIDATE — BLOCKED FOR RELEASE.** The owner selected OpenAI and a new dedicated key. The secure local-destination tool returned not approved twice, including the owner-requested retry. No key was created or written, and no real OpenAI request was sent. This source work does not bypass that credential workflow or activate production.

## Exact implementation

- `lib/beauty.ts` passes the selected verifier only for Beauty post media. `lib/salon-profile.ts` passes it only for look/update post media. Identity/logo/cover/review/staff-image paths, payroll, tax, bank and Support uploads are not added to this adapter path.
- Both callers evaluate `withPublicPhotoProcessingConsent` before private-image preparation. Missing, declined, inherited, wrong-provider or stale permission fails closed before the private image is downloaded or any provider request can run.
- `photoProcessingConsent` is an optional input for backwards-compatible parsing; it is **required for a new photo check**, with exactly `{provider:"openai", noticeVersion:"public-photo-openai-20261118-v1", accepted:true}`. It is not general account consent or a safety approval.
- Beauty raw request intent includes the permission only when it was supplied. Salon raw submission already retains the submitted input. Successful idempotent submissions therefore bind that choice with the current actor, request and image paths; this does not claim an independent consent log for every failed attempt or non-idempotent legacy caller.
- Completed Beauty/Salon request lookup remains before new permission, admission or provider work. Legacy saved request intent is unchanged when the new field is absent. Recovery never re-sends an already confirmed photo merely because the key, notice or provider is unavailable later.
- OpenAI receives only the full normalized final WebP bytes in the adapter payload. The same bytes are hashed, uploaded and attested after a validated allowed verdict. Captions, actor/salon IDs, bank data, Storage URLs and the permission object are not added to the OpenAI request body.
- Privacy candidate names OpenAI, the selected post-photo purpose, possible personal information in image pixels, and the ability to keep a draft. It makes no promise of anonymization, universal harmful-content detection, copyright verification, no training, US-only storage or a provider retention deadline.

## Explicit user permission and the pending UI

Apple's [5.1.2(i) Data Use and Sharing](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing) requires disclosure of third-party AI sharing and explicit permission before the relevant personal-data transfer. Selecting the provider as the app owner is not permission from each person using the app. Publishing a Privacy document alone is insufficient to establish that permission.

The shared notice/unchecked-checkbox proposal is artifact-only: [consent preview](../artifacts/public-photo-processing-consent-20261118/photo-processing-consent-preview-desktop.png). The current product composers do not yet send this affirmative field. Consequently, new photo submission remains blocked until reviewed consent controls are implemented; this must not be released just because a server key becomes available. Old callers lacking the new permission cannot silently send photos to OpenAI. Existing identity-image paths remain outside this photo-check scope.

The owner separately requested adjustments to the admin exact-text Remove/Restore preview. That workflow still has no newly implemented product controls. It concerns reports and appeals after posting and does not introduce routine admin preapproval of photos.

## Validation and limits

`node --test tests/public-photo-consented-wiring.test.mjs` passes **11/11**, no skips. Tests execute the actual selected source functions, real normalizer/core/adapter with synthetic transport and Storage fixtures, and verify permission propagation, exact-byte attestation, missing permission, provider failure/rejection, identity-image exclusion, old completed-request recovery and unchanged legacy intent. No real network or customer data is used. Scoped ESLint passes.

Adapter acceptance is recorded separately in [OpenAI verifier notes](openai-public-photo-verifier-20261118.md). Its real model response, accuracy, latency, quota and provider-account settings still require acceptance after secure key setup. The general image moderation endpoint does not establish PII/copyright rights or full CSAM coverage; known/suspected CSAM must not be sent through the general moderation flow. The documented specialist-model/operations decision remains separate.

Before publication: complete secure setup without exposing the key; approve and implement consent UI; verify the selected project/provider terms and response; test consent decline/retry/role switching on the exact candidate; review policy dates/version/notice and App Privacy; rebuild bundled client/native source as required; integrate with the single combined final release. No push, deployment, native upload or Apple declaration occurred here.
