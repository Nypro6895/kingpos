/** Upload work is bounded end to end, including conversion. Results retain the
 * selection order. On failure/invalidation, wait for active work before removing
 * every successful output, including successes that arrive after the failure.
 * A callback that allocates a path and then rejects must clean that path itself.
 */
export class PublicImageUploadCancelledError extends Error {
  constructor() {
    super("The photo selection changed before uploading finished.");
    this.name = "PublicImageUploadCancelledError";
  }
}

export async function runPublicImageUploadBatch<Input, Output>(options: {
  items: readonly Input[];
  upload: (item: Input, index: number) => Promise<Output>;
  cleanup: (output: Output, index: number) => Promise<void> | void;
  isCurrent?: () => boolean;
  concurrency?: number;
}): Promise<Output[]> {
  const current = options.isCurrent ?? (() => true);
  const requested = options.concurrency ?? 2;
  const concurrency = Number.isFinite(requested) ? Math.max(1, Math.min(2, Math.floor(requested))) : 2;
  const results: Array<{ value: Output; index: number } | undefined> = new Array(options.items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const reject = (error: unknown) => {
    if (!failed) { failed = true; failure = error; }
  };
  async function worker() {
    while (!failed && next < options.items.length) {
      if (!current()) { reject(new PublicImageUploadCancelledError()); return; }
      const index = next++;
      try {
        const value = await options.upload(options.items[index], index);
        results[index] = { value, index };
        if (!current()) reject(new PublicImageUploadCancelledError());
      } catch (error) { reject(error); }
    }
  }
  if (!current()) throw new PublicImageUploadCancelledError();
  await Promise.all(Array.from({ length: Math.min(concurrency, options.items.length) }, worker));
  if (!current()) reject(new PublicImageUploadCancelledError());
  if (failed) {
    await Promise.allSettled(results.flatMap(result => result
      ? [Promise.resolve().then(() => options.cleanup(result.value, result.index))] : []));
    throw failure;
  }
  return results.map(result => result!.value);
}
