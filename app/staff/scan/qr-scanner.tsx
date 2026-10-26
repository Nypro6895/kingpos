"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import styles from "./scan.module.css";

export function StaffQrScanner({ onCode, onClose, hint = "Point at the customer's check-in QR.", fallbackMessage = "Allow camera access, or select a customer from Waiting." }: { onCode: (code: string) => void; onClose: () => void; hint?: string; fallbackMessage?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCode);
  const [error, setError] = useState("");
  useEffect(() => { callback.current = onCode; }, [onCode]);
  useEffect(() => {
    let stream: MediaStream | undefined, stopped = false, timer: ReturnType<typeof setTimeout>;
    const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); };
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(fallbackMessage);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!video.current) { stop(); return; }
        video.current.srcObject = stream;
        await video.current.play();
        // Loaded only when Scan is opened. Works without BarcodeDetector.
        const { default: jsQR } = await import("jsqr");
        if (stopped) return;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error(fallbackMessage);
        const scan = () => {
          if (stopped || !video.current) return;
          const frame = video.current;
          if (frame.readyState >= 2 && frame.videoWidth) {
            const scale = Math.min(1, 640 / frame.videoWidth);
            canvas.width = Math.round(frame.videoWidth * scale); canvas.height = Math.round(frame.videoHeight * scale);
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
            if (result?.data) { stop(); callback.current(result.data); return; }
          }
          timer = setTimeout(scan, 250);
        };
        scan();
      } catch (failure) {
        if (!stopped) { stop(); setError(failure instanceof Error && failure.message.startsWith("Camera") ? failure.message : fallbackMessage); }
      }
    }
    void start();
    const hide = () => { if (document.visibilityState !== "visible") { stop(); onClose(); } };
    document.addEventListener("visibilitychange", hide);
    return () => { stop(); document.removeEventListener("visibilitychange", hide); };
  }, [onClose, fallbackMessage]);
  return <section className={styles.camera} aria-label="QR camera">
    <video ref={video} muted playsInline aria-label="Customer QR camera" />
    {error ? <p role="alert"><WorkspaceText text={error} /></p> : <p><WorkspaceText text={hint} /></p>}
    <button type="button" onClick={onClose}><WorkspaceText text="Close camera" /></button>
  </section>;
}
