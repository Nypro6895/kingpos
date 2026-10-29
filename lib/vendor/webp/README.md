# Bundled WebP encoder

Vendored from @jsquash/webp1.5.0 (https://github.com/jamsinclair/jSquash), Apache-2.0; exact npm tarball integrity is in the integration evidence. Only the non-SIMD encoder and default options are used. No decoder, native permission, remote script or network resource is loaded.

WASM SHA256: b6085bb6702f144e9dc6016d58d230b34a84976bf0d080b7390b4b4b137d6ab7.

Browser glue change: replace the unused default import.meta-relative WASM URL with a string. The reviewed encoder always receives embedded wasmBinary plus locateFile, so no fallback resource fetch is used. Generated base64 bytes are unchanged from the package WASM.

Additional browser-only adaptation: omit the generated import.meta URL fallback because all encoder bytes are embedded and no module-relative resource can be fetched.
