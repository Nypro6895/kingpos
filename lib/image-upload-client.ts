import { IMAGE_POLICY, type ImageBounds } from "./image-policy";

export async function prepareImageUpload(file: File) {
  // Keep animation intact; the server handles its frame/pixel/output budgets.
  if (file.type === "image/gif" || file.type === "image/webp") return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Image could not be read.")); image.src = url; });
    if (image.naturalWidth * image.naturalHeight > IMAGE_POLICY.maxInputPixels) throw new Error("Choose an image smaller than 40 megapixels.");
    const scale = Math.min(1, IMAGE_POLICY.maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("Image processor is not available.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { blob } = await compressImageCanvas(canvas);
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" });
  } finally { URL.revokeObjectURL(url); }
}

/** Compress an already cropped canvas, reducing dimensions if quality alone is insufficient. */
export async function compressImageCanvas(source: HTMLCanvasElement, bounds: ImageBounds = {}) {
  const scale = Math.min(1, (bounds.maxWidth ?? IMAGE_POLICY.maxEdge) / source.width,
    (bounds.maxHeight ?? IMAGE_POLICY.maxEdge) / source.height,
    IMAGE_POLICY.maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processor is not available.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const target = Math.min(bounds.targetBytes ?? IMAGE_POLICY.targetBytes, IMAGE_POLICY.maxBytes);
  for (let size = 0; size < 9; size++) {
    for (const quality of [.8, .72, .62]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error("Image could not be processed.")), "image/webp", quality));
      // Safari can decode WebP while canvas.toBlob silently returns PNG.
      // Convert the cropped pixels on the server, preserving transparency and
      // the WebP storage contract used by all upload callers.
      if (blob.type !== "image/webp") {
        if (blob.size > IMAGE_POLICY.maxInputBytes) break;
        const response = await fetch("/api/images/normalize", {
          method: "POST", credentials: "same-origin", body: blob,
          headers: { "Content-Type": blob.type },
        });
        if (!response.ok) throw new Error("Image could not be processed. Please try again.");
        const converted = await response.blob();
        const width = Number(response.headers.get("X-Image-Width"));
        const height = Number(response.headers.get("X-Image-Height"));
        if (converted.type !== "image/webp" || !converted.size || converted.size > IMAGE_POLICY.maxBytes ||
          !Number.isInteger(width) || width < 1 || width > canvas.width ||
          !Number.isInteger(height) || height < 1 || height > canvas.height)
          throw new Error("Image could not be processed. Please try again.");
        return { blob: converted, width, height };
      }
      if (blob.size <= target || (quality === .62 && blob.size <= IMAGE_POLICY.maxBytes))
        return { blob, width: canvas.width, height: canvas.height };
    }
    // Copy before resizing, since assigning canvas dimensions clears its contents.
    const copy = document.createElement("canvas");
    copy.width = canvas.width; copy.height = canvas.height;
    const copyContext = copy.getContext("2d");
    if (!copyContext) throw new Error("Image processor is not available.");
    copyContext.drawImage(canvas, 0, 0);
    canvas.width = Math.max(1, Math.floor(canvas.width * .8));
    canvas.height = Math.max(1, Math.floor(canvas.height * .8));
    ctx.drawImage(copy, 0, 0, canvas.width, canvas.height);
  }
  throw new Error("This image could not be reduced safely. Please choose another image.");
}
