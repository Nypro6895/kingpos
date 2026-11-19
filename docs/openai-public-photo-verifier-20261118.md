# OpenAI public post photo verifier — local candidate, 2026-11-18

## Current update — provider/key gate resolved, integration pending

The owner subsequently created and saved the dedicated key manually outside Git. The actual adapter passed the authorized synthetic-image provider probe; see [live acceptance](openai-photo-live-acceptance-20261118.md). The end-user permission UI was separately approved and implemented. The source is now awaiting combined integration, verified hosted configuration and final native/device acceptance, rather than waiting for another key-creation confirmation. No key was copied into this document or journal. The original patch-status paragraph below is historical; one probe does not establish classifier accuracy or a latency guarantee.

## Original patch status before the owner's manual setup

User choice of OpenAI with a new dedicated key is confirmed. Secure local destination confirmation returned `not-approved` twice; key creation/writing is stopped. This task does not inspect an existing key, create/write a secret, read/change an env file, make a live OpenAI request or activate public uploads. The adapter is implemented with mocked-transport acceptance only. Publication remains **blocked** pending secure configuration, real provider acceptance and the separate product/release gates below.

## Contract and provenance

The official [Create moderation API](https://developers.openai.com/api/reference/resources/moderations/methods/create), checked 2026-11-18, accepts image input through `POST https://api.openai.com/v1/moderations` and the `image_url` input variant, including inline base64 data. The [omni-moderation model page](https://developers.openai.com/api/docs/models/omni-moderation-latest) lists `omni-moderation-latest` and the supported dated snapshot `omni-moderation-2024-09-26`.

`lib/public-image-verifier-openai.ts` exposes:

- `verifyOpenAIPublicPostImage(image: Buffer)`: existing verifier seam; environment key is resolved only when called.
- `createOpenAIPublicPostVerifier({apiKey?, fetchImpl?, timeoutMs?})`: same seam with injectable transport/configuration for isolated tests. No SDK dependency or runtime import of `public-image-safety.ts` is added; the seam import is type-only.
- Request model: `omni-moderation-latest`. Attestation provider: `openai`. Local policy version: `reylumi-public-photo-openai-20261118-v1`. This version describes this request/validation/flag policy; it is not a promise that the provider's `latest` model is frozen.

The actual supported `model` string returned by the provider is retained for attestation, rather than replacing it with the requested alias. If the provider returns the alias, that is the evidence available; the adapter does not invent an underlying snapshot identity. An unknown returned model fails closed until reviewed.

## Implemented boundary

Input must be a complete decodable still WebP, no larger than `500 * 1024` bytes, with neither edge above 1600 pixels and no embedded EXIF/ICC/XMP/IPTC/orientation metadata. RIFF length/chunk checks also reject appended bytes and unknown nonpixel chunks. The shared normalization pipeline supplies the final pixels; this adapter validates them again, including full decode. It does not accept a remote image URL, caption, author identity, salon ID, file path, original metadata or document payload. The request contains the selected model and one inline data URL containing those full final image bytes.

The server sends the credential only in the Authorization header to the fixed HTTPS endpoint. There is no alternate base URL, redirect following, automatic retry or client-side provider call. No image/key/request/response/provider body/header is logged by the adapter. Removing metadata does not anonymize identifiable people or information visible in the pixels; the provider still receives the photo for classification. Provider privacy terms, actual project controls and any required public notice are separate acceptance items, not proven by the absence of local logging.

Transport plus response reading has a 10-second default deadline, configurable only from 1 to 12,000 milliseconds. Abort and a deadline race bound stalled requests and body streams; body readers are cancelled. Successful JSON is read as a stream with a 32-KiB cap, not with an unbounded `response.json()`/`text()`. Non-200 responses, redirects, another endpoint URL, wrong content type, excessive/invalid declared length, oversized/invalid UTF-8/JSON and I/O errors yield only a generic draft-kept unavailable error. Local bounded image decoding precedes the transport deadline.

Approval requires exactly one complete moderation result with the reviewed schema: all 13 boolean category flags, numeric finite scores in `[0,1]`, reviewed input-type coverage and a supported returned model. The six image-supported categories must show image evaluation; text-only categories must have no applied input in this image-only request. Missing/extra/unknown or malformed schema is unavailable. Aggregate `flagged=true` or any explicit category flag rejects. Only a validated unflagged result with every flag false allows. Scores are validated but no custom thresholds are invented. No raw provider detail, request ID, scores or categories leave the adapter's verdict.

Errors become the existing verifier seam's unavailable outcome, which preserves the draft. A valid flagged verdict becomes the existing rejection/Support path. This adapter does not itself upload, approve SQL manifests, publish, retry a post, change admin authority or suspend an account. Exact-byte public-copy/hash approval remains the core/SQL pipeline's job; root owns explicit Beauty/Salon caller wiring. It must not be used as a blanket default for other image/document uploads.

## Coverage and operational limits

The official [moderation guide](https://developers.openai.com/api/docs/guides/moderation) lists six image-capable categories: sexual, three self-harm categories and two violence categories. Other categories, including `sexual/minors`, are text-only; zero/false for an unsupported category is not evidence that an image was checked for that harm. The guide prohibits sending known or suspected CSAM to the general model. The separate [CSAM classifier](https://developers.openai.com/api/docs/guides/csam-classifier) requires an approved organization and is not implemented or requested by this adapter.

An unflagged model signal is not a guarantee that an image is safe, legal, owned/licensed, free of personal data, free of CSAM, within every Community Guideline or suitable for every audience. This adapter does not perform PII redaction, copyright/consent verification, age verification or a general OCR/text-policy check. Report/block, responsive takedown, human false-positive appeal, privacy controls and child-safety escalation remain necessary product/operations work. Do not send a known/suspected prohibited image to this adapter as a test or ordinary retry.

## Evidence and activation gates

`tests/public-image-verifier-openai.test.mjs` uses generated nonsensitive images and mocked transport only. Its bundle replaces the environment expression with a synthetic global before module execution; it never reads the machine's real API key. The default fetch is replaced with a rejecting guard, so an accidental unmocked path cannot reach the network. It checks full-byte inline request/privacy shape, known snapshot attestation, transparent/lossless images, every explicit category flag, missing/lazy key, malformed/unknown result, rejected input formats/animation/metadata/dimensions/size/extra chunks, HTTP/rate-limit/network/redirect errors, byte/UTF-8/JSON bounds, stalled request/body deadlines, cancellation, invalid configuration and generic error messages. All 11 tests pass; scoped ESLint and strict TypeScript checking against the actual verifier seam pass without emitted files.

No live classifier accuracy, account/model access, real response-shape compatibility, latency, provider retention/configuration, real-photo safety, public activation, hosted schema, physical iOS behavior or App Review acceptance is claimed. Before activation, the coordinator must finish the secure dedicated-key workflow with a separately approved destination; configure the intended project without plaintext disclosure; review provider processing/privacy notices; obtain authorized real-provider acceptance with benign images; confirm failure/pending/draft UX and the strict response/input-type contract; complete child-safety and human report/appeal operations; and validate/release the exact combined candidate. Key creation and live tests remain stopped until the missing authorization is resolved.

The separate exact-text Remove/Restore preview remains pending user approval. This adapter does not implement that backend or UI, change public-media cleanup or cover/avatar handling, or close the moderation gaps recorded in `docs/ios-moderation-operations-20261118.md`.
