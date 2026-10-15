export type MediaUploadPhase = "preparing" | "uploading" | "confirming" | "saving" | "complete";

/** Weight progress by processed bytes, not the number of files or a timer. */
export function mediaBatchProgress(completedBytes: number, fileBytes: number, filePercent: number, totalBytes: number) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  const transferred = Math.max(0, completedBytes) + Math.max(0, fileBytes) * Math.max(0, Math.min(100, filePercent)) / 100;
  return Math.max(0, Math.min(100, Math.floor(transferred / totalBytes * 100)));
}
