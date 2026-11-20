"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import type { MediaUploadPhase } from "@/lib/media-upload-progress";
import styles from "./loading-feedback.module.css";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => { window.removeEventListener("online", onChange); window.removeEventListener("offline", onChange); };
}
const getOnline = () => navigator.onLine;
const getServerOnline = () => true;

export function MediaUploadProgress({ phase = "uploading", progress, current = 1, total = 1 }: {
  phase?: MediaUploadPhase; progress?: number; current?: number; total?: number;
}) {
  const t = useWorkspaceTranslation();
  const online = useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
  const known = typeof progress === "number" && Number.isFinite(progress);
  const percent = known ? Math.max(0, Math.min(100, Math.floor(progress))) : 0;
  const stage = !online && phase !== "complete" ? "offline" : phase === "uploading" && percent >= 100 ? "confirming" : phase;
  const title = {preparing:"Preparing your photos…",uploading:"Sending a little beauty…",confirming:"Confirming your photos…",saving:"Finishing your post…",complete:"Your photos are ready!",offline:"Connection interrupted"}[stage];
  const detail = stage === "offline" ? t("Check your connection, then try again.")
    : stage === "preparing" ? t("Optimizing your photos")
    : stage === "saving" || stage === "confirming" ? t("Waiting for confirmation")
    : stage === "complete" ? `${total}/${total} ${t("photos uploaded")}`
    : `${t("Photo")} ${Math.min(current,total)}/${total}${known ? ` · ${percent}%` : ""}`;
  const determinate = known && stage !== "preparing" && stage !== "saving";
  return <div className={styles.upload} data-phase={stage} data-active={stage !== "offline" && stage !== "complete"} style={{"--upload-fraction":percent/100,"--upload-percent":`${percent}%`} as CSSProperties}>
    <span className={styles.spark}><ReylumiIcon name={stage === "complete" ? "check" : "sparkle"} className="h-7 w-7" /></span>
    <div className={styles.copy}><p className={styles.title} role="status">{t(title)}</p><p className={styles.detail}>{detail}</p></div>
    <div className={`${styles.track} ${!determinate ? styles.indeterminate : ""}`} role="progressbar" aria-label={t("Photo upload progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? percent : undefined} aria-valuetext={`${t(title)} · ${detail}`}>
      <span className={styles.fill} />
      {determinate && stage === "uploading" ? <span className={styles.head}><ReylumiIcon name="sparkle" /></span> : null}
    </div>
  </div>;
}
