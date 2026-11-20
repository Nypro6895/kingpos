import factory, { type WebPEncoder } from "./vendor/webp/webp-encoder.mjs";
import { defaultOptions } from "./vendor/webp/meta.js";
import instantiate from "./vendor/webp/webp-encoder-js.mjs";
import { IMAGE_POLICY } from "./image-policy";

let encoder: Promise<WebPEncoder> | undefined;
function loadEncoder() {
  if (!encoder) {
    encoder = factory({ noInitialRun: true, locateFile: file => file, instantiateWasm(imports, receive) {
      const exports = instantiate(imports);
      receive({ exports });
      return exports;
    } }).catch(() => {
      encoder = undefined;
      throw new Error("Image could not be processed. Please try again.");
    });
  }
  return encoder;
}

/** Local pixels only: no cookies, RPC, URL forwarding, metadata or temporary storage. */
export async function encodeCanvasWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 1 || canvas.height < 1
    || canvas.width > IMAGE_POLICY.maxEdge || canvas.height > IMAGE_POLICY.maxEdge || !Number.isFinite(quality) || quality < .1 || quality > 1) {
    throw new Error("Image could not be processed.");
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processor is not available.");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const codec = await loadEncoder();
  const encoded = codec.encode(image.data, canvas.width, canvas.height, { ...defaultOptions, quality: quality * 100 });
  if (!encoded || encoded.byteLength < 12 || encoded.byteLength > IMAGE_POLICY.maxInputBytes
    || String.fromCharCode(...encoded.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...encoded.subarray(8, 12)) !== "WEBP") {
    throw new Error("Image could not be processed.");
  }
  return new Blob([new Uint8Array(encoded)], { type: "image/webp" });
}
