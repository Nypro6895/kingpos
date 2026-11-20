"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedUiDraft } from "@/lib/use-scoped-ui-draft";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { WorkspaceText } from "@/components/workspace-language";
import {
  loadServiceRelay,
  respondServiceRelay,
  findServiceRelay,
} from "./actions";
import type { RelayWorkspace } from "@/types/service-relay";
import { useRouter } from "next/navigation";
import { connectStaffScan } from "@/app/staff/scan/actions";
import styles from "./service-relay.module.css";

export function StaffRelay({
  salonId,
  scope,
  initialData,
  managedRead = false,
  refreshResource,
}: {
  salonId: string;
  scope?: string;
  initialData?: RelayWorkspace;
  managedRead?: boolean;
  refreshResource?: () => Promise<void>;
}) {
  const router = useRouter();
  const [data, setData] = useState<RelayWorkspace | null>(initialData ?? null);
  const [source, setSource] = useState(initialData);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [code, setCode] = useState("");
  if (managedRead && initialData && source !== initialData) {
    setSource(initialData);
    setData(initialData);
    setError("");
  }
  const loading = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      if (managedRead && refreshResource) {
        await refreshResource();
        return;
      }
      const result = await loadServiceRelay();
      if (result.data) {
        setData(result.data);
        setError("");
      } else setError(result.error ?? "Could not refresh.");
    } catch {
      setError(
        "Reconnect to see your next customer. Your current entries are kept.",
      );
    } finally {
      loading.current = false;
    }
  }, [managedRead, refreshResource]);
  useEffect(() => {
    const timer = !managedRead
      ? setTimeout(() => {
          void refresh();
        }, 0)
      : undefined;
    const unsubscribe = subscribePosChanges(salonId, (change) => {
      if (["staff", "waiting", "tickets"].includes(change.resource))
        void refresh();
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }, [salonId, refresh, managedRead]);
  useEffect(() => {
    if (!data?.installed) return;
    const timer = setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible")
        void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [data?.installed, refresh]);
  async function respond(id: string, accept: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await respondServiceRelay(id, accept);
      if (result.error) {
        await refresh();
        setError(result.error);
      } else await refresh();
    } catch {
      setError(
        "Connection interrupted. Refresh before accepting another customer.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!data?.installed) return error ? <p role="status">{error}</p> : null;
  if (!data.tickets.some((ticket) => !ticket.scanMode)) return null;
  return (
    <section className={styles.panel} aria-label="Phone Checkin">
      <div className={styles.header}>
        <h2>
          <WorkspaceText text="Your next customer" />
        </h2>
        <button onClick={() => setFinding(!finding)}>
          <WorkspaceText text="Find customer" />
        </button>
      </div>
      {finding && (
        <form
          className={styles.actions}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              const result = await findServiceRelay(code);
              if (result.error) setError(result.error);
              else {
                setFinding(false);
                setCode("");
                await refresh();
              }
            } catch {
              setError("Reconnect to find the customer.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="Check-in number or QR link"
            placeholder="Check-in number or QR link"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <RelayScanner onCode={setCode} />
          <button disabled={busy} className={styles.primary}>
            Find
          </button>
        </form>
      )}
      {!data.tickets.length && (
        <div className={styles.waiting}>
          <span className={styles.badge}>Ready</span>
          <p>POS will send your next customer here.</p>
        </div>
      )}
      {data.tickets.map((ticket) => {
        if (ticket.scanMode) return null;
        const offer = ticket.offers.find(
          (o) =>
            o.staffId === data.staffId &&
            ["offered", "working", "done"].includes(o.status),
        );
        if (!offer) return null;
        return offer.status === "offered" ? (
          <article key={offer.id} className={styles.card} role="status">
            <h3>
              {ticket.customerName} · #{ticket.queueNumber}
            </h3>
            <p>{offer.serviceName}</p>
            <p className={styles.muted}>
              POS assigned this customer. Please respond within 60 seconds.
            </p>
            <div className={styles.actions}>
              <button
                disabled={busy}
                className={styles.primary}
                onClick={() => void respond(offer.id, true)}
              >
                Accept
              </button>
              <button
                disabled={busy}
                onClick={() => void respond(offer.id, false)}
              >
                Decline
              </button>
            </div>
          </article>
        ) : (
          <article className={styles.card} key={offer.id}>
            <h3>
              {ticket.customerName} · #{ticket.queueNumber}
            </h3>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!data.staffId || busy) return;
                setBusy(true);
                try {
                  const result = await connectStaffScan(
                    { salonId, staffId: data.staffId },
                    { visitId: ticket.visitId },
                  );
                  if (result.error) setError(result.error);
                  else router.push("/staff/scan");
                } catch {
                  setError("Reconnect to open this ticket.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <WorkspaceText text="Open held ticket" />
            </button>
          </article>
        );
      })}
      {error && (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      )}
    </section>
  );
}
function RelayScanner({ onCode }: { onCode: (code: string) => void }) {
  const [active, setActive] = useState(false),
    [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | undefined,
      stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => {
          detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>;
        };
      }
    ).BarcodeDetector;
    if (!Detector) {
      queueMicrotask(() => {
        if (!stopped)
          setError(
            "Camera scan is unavailable here. Enter the check-in number or paste its link.",
          );
      });
      return () => {
        stopped = true;
      };
    }
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (next) => {
        stream = next;
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]) {
              onCode(codes[0].rawValue);
              setActive(false);
              return;
            }
          } catch {
            /* Retry camera frames. */
          }
          timer = setTimeout(scan, 300);
        };
        void scan();
      })
      .catch(() => setError("Camera unavailable. Enter the check-in number."));
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onCode]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setActive(!active);
        }}
      >
        {active ? "Stop scan" : "Scan QR"}
      </button>
      {active && (
        <video ref={video} muted playsInline className={styles.scan} />
      )}
      {error && <p role="status">{error}</p>}
    </>
  );
}
