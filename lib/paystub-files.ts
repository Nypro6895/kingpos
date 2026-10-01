// A failed cleanup must not turn a successfully saved paystub into a failed upload.
export async function cleanupPaystubFile(
  path: string | null | undefined,
  remove: (path: string) => Promise<{ error: unknown }>,
) {
  if (!path || /^https?:\/\//i.test(path)) return;
  try {
    const result = await remove(path);
    if (result.error) console.warn("Unused paystub file cleanup failed.");
  } catch {
    console.warn("Unused paystub file cleanup failed.");
  }
}
