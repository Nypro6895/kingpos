// Bounds the UI wait; callers still need transport/query timeouts to stop work.
export async function withDashboardDeadline<T>(work: Promise<T>, ms = 1800): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Couldn't load — retry.")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
