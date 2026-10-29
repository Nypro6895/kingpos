# Bundled WebP encoder

Source: @jsquash/webp1.5.0 (jSquash/Squoosh/libwebp), Apache-2.0 and libwebp BSD notices in LICENSE and LIBWEBP-COPYING. Notices are also embedded in codec glue and retained in distributed JavaScript.

The pinned non-SIMD encoder WASM is a build-time compiler input only. Binaryen132 wasm2js converts it to ordinary JavaScript, then a static wrapper returns its exports to the existing Emscripten codec glue. No WebAssembly compilation, eval, remote resource, native permission, credential or CSP change is used at runtime.

Compiler command and input hashes are recorded in provenance.json. The generated module is initialized only when the installed canvas cannot encode WebP. Input is bounded cropped RGBA pixels; upload authorization and format/size checks remain unchanged. Browser tests enforce self-only CSP, prove WASM compile is blocked, validate real WebP with alpha and exercise memory growth at1600x1600.

Glue adaptations: omit unused import.meta-relative resource fallback; always supply the reviewed static instantiateWasm callback (name inherited from upstream API, implementation is JavaScript).
