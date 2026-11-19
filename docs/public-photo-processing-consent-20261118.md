# Public photo AI processing permission — 2026-11-18

Local implementation and artifact-only UI proposal. No product UI, provider/credential workflow, public activation or hosted change is made by this patch. The frozen OpenAI adapter and the separate admin Remove/Restore proposal remain untouched.

## Why this boundary exists

[Apple App Review Guideline 5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing), checked 2026-11-18, requires clear disclosure of third-party sharing, including AI, and explicit permission before that transfer. Owner selection of OpenAI, an API key, a general Privacy policy or publication intent alone does not establish the end user's specific permission. This helper is one implementation prerequisite; it is not a complete legal/App Review compliance determination.

## Client-safe notice and helper

`lib/public-photo-processing-consent.ts` exports the requested type:

```ts
type PublicPhotoProcessingConsent = {
  provider: "openai";
  noticeVersion: string;
  accepted: boolean;
};
```

Current notice version: `public-photo-openai-20261118-v1`.

Shared notice: “To check the photos in this post before publication, Reylumi sends processed copies to OpenAI for an automated safety check. Photos can include people or personal information.”

Unchecked checkbox label: “I agree to send the photos in this post to OpenAI for this safety check.”

Decline copy: “Without agreement, keep your draft or leave without posting these photos.” The shared Privacy href is `/privacy`. The actual Privacy disclosure must describe the implemented processing before activation; the link alone is not permission or proof that public text has changed.

`assertPublicPhotoProcessingConsent(unknown)` rejects missing, declined, malformed, inherited, stale-version, other-provider and additional generic permission fields. It accepts only the three own fields with the exact current provider/version and literal boolean `true`; it does not coerce a string/number into agreement.

`withPublicPhotoProcessingConsent(consent, verifier)` calls that assertion **synchronously** and then returns the **same verifier callback**. It does not invoke the callback, make a transfer, load a private image, broaden the data scope, wrap/retry an operation or manufacture approval. A rejected/failed safety verdict remains rejected/failed. A type-only seam import is erased from the client bundle: no server-only module, image decoder, credentials, provider runtime or network call is pulled into the notice module.

Root owns caller/types/request-intent wiring. Evaluate the helper before invoking private photo preparation, so a rejected choice cannot reach its private download or provider path. The library does not infer consent from past posts, account state, a remembered key or a policy link. The consent object is an input attestation, not cryptographic proof that a person viewed a notice or checked a box.

## Caller and UI acceptance still required

- Completed request receipt lookup stays **before** new permission/admission checks. Resolving a previously committed post must not become a new transfer or fail because the old client lacked this newly added field. Do not republish or resurrect deleted/held content during receipt recovery.
- Bind the affirmative choice/current notice to the current raw submission intent. Missing/stale consent must stop a new transfer; an older client does not receive a silent default. A provider/notice change needs a newly accepted version. Reset the unchecked UI for a new submission and when the photo set changes; do not make the library an account-wide “all uploads” grant.
- Provide the notice, recipient, purpose, unchecked affirmative choice and Privacy link before any AI transfer. Keep a meaningful decline/draft path, and let the user change the choice before sending. Do not precheck it from publication/Terms acceptance, stored drafts or a prior post. Private staging to Reylumi is a separate existing storage step; do not claim that selecting a photo leaves it solely on-device until this box is checked.
- Permission covers the current public post photo safety check only. It does not authorize payroll/Tax/Check Writer documents, support evidence, captions/account identifiers, avatars/covers, unrelated AI uses, training, advertising or routine human preapproval. Pixels can still contain personal information; metadata removal is not anonymization.
- This helper does not add a durable consent ledger, prove end-user interaction, configure provider privacy/retention or revoke copies already transferred. Actual request binding, receipt/audit evidence, withdrawal/deletion behavior, accessible UI, notice translations, real-provider acceptance and the full assembled release require separate validation.

## Artifact-only composer proposal

`artifacts/public-photo-processing-consent-20261118/photo-processing-consent-preview.html` and desktop/mobile PNGs show separate Beauty and Salon composer examples. They reuse the current brand tokens and composer structure from `app/beauty/beauty-profile-client.tsx:2475` and `app/salon-profile/salon-profile-view.tsx:1949`. Photos are locally generated synthetic nail illustrations, never real customer data.

The compact notice sits below the selected photo/options; both checkboxes start unchecked and both Post buttons disabled. Checkbox interaction only demonstrates button state. No preview control uploads or contacts a service. The preview Privacy link points to a local explanatory note; the product href remains `/privacy`.

This is a distinct photo-upload proposal, not an administrator approval step. User visual approval and actual product UI wiring remain pending. The user requested an adjustment to the separate admin text-removal preview; that artifact was not modified by this task.

## Validation and handoff

Four non-skipped tests in `tests/public-photo-processing-consent.test.mjs` pass. They verify that invalid permission throws before a simulated private-prepare function can run, so neither private read nor provider callback is reached; accepted permission returns the exact callback without invoking or mutating it; rejection/failure is never converted into approval; and a browser-target bundle contains no server/key/provider dependency. Scoped ESLint and strict TypeScript seam checking pass. Desktop1180/mobile390 artifacts were rendered in local headless Chromium and visually inspected, with default unchecked state confirmed. This is not native iOS/Safari/device or live provider acceptance.

The helper's isolated source scope is complete but requires integration. Public activation stays blocked: product consent UI and request binding, secure dedicated-key configuration (local destination was not approved), provider/privacy/operations acceptance, and combined build/hosted/device/release gates remain open. No commit, push, deployment, env read/write or real API request was performed.
