/** All ad reads/claims are bounded. Never retry a possibly committed view automatically. */
export async function adRequest(url: string, init: RequestInit = {}, timeout = 4000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error("Advertising unavailable");
    return await response.json();
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export function prepareAdImage(url: string, signal: AbortSignal, timeout = 6000, srcset?: string): Promise<boolean> {
  if (!url) return Promise.resolve(!signal.aborted);
  return new Promise(resolve => {
    const image = new Image();
    let finished = false;
    const done = (ok: boolean) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      image.onload = image.onerror = null;
      signal.removeEventListener("abort", abort);
      if (!ok) image.src = "";
      resolve(ok);
    };
    const abort = () => done(false);
    const timer = setTimeout(abort, timeout);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { done(false); return; }
    image.decoding = "async";
    if (srcset) { image.sizes = "(max-width: 600px) 90vw, 380px"; image.srcset = srcset; }
    image.onload = () => {
      if (typeof image.decode === "function") void image.decode().then(() => done(true), () => done(false));
      else done(true);
    };
    image.onerror = () => done(false);
    image.src = url;
  });
}
