import sharp from "sharp";
/** Re-encode, never forward originals or metadata to app developers. */
export async function sanitizedPublicImage(bytes: Uint8Array) {
  if (bytes.byteLength > 4194304) throw Error("Image too large");
  const b = Buffer.from(bytes);
  const raster =
    (b[0] === 255 && b[1] === 216 && b[2] === 255) ||
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP");
  if (!raster) throw Error("Unsupported raster image");
  const output = await sharp(bytes, {
    limitInputPixels: 16000000,
    animated: false,
    failOn: "warning",
  })
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toBuffer();
  if (output.byteLength > 1048576) throw Error("Processed image too large");
  return output;
}
export async function boundedImageBody(response: Response) {
  if (
    !response.ok ||
    Number(response.headers.get("content-length") ?? 0) > 4194304
  )
    throw Error("Image unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw Error("No image body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 4194304) throw Error("Image too large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
