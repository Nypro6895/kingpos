import "server-only";
import { resolve4 } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { IMAGE_POLICY } from "./image-policy";

export function isPublicImageAddress(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 2, 168].includes(b)) ||
    (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}

/** HTTPS only; pin a vetted public address to prevent DNS rebinding and validate each redirect. */
export async function downloadPublicImage(value: string, redirects = 0): Promise<Buffer> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || redirects > 3)
    throw new Error("Use a public HTTPS image URL.");
  const addresses = isIP(url.hostname) ? [url.hostname] : await Promise.race([
    resolve4(url.hostname),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Image lookup timed out.")), 4000); timer.unref(); }),
  ]);
  if (!addresses.length || addresses.some(address => !isPublicImageAddress(address)))
    throw new Error("Use a public HTTPS image URL.");
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      family: 4,
      lookup: (_host, _options, callback) => callback(null, addresses[0], 4),
      headers: { Accept: "image/*" },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
        res.destroy();
        void downloadPublicImage(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200 || Number(res.headers["content-length"] ?? 0) > IMAGE_POLICY.maxInputBytes) {
        res.destroy(); reject(new Error("Image unavailable or larger than 10 MB.")); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > IMAGE_POLICY.maxInputBytes) req.destroy(new Error("Image is larger than 10 MB."));
        else chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    // Hard deadline includes response body, even if the peer keeps sending bytes slowly.
    const timer = setTimeout(() => req.destroy(new Error("Image download timed out.")), 6000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}
