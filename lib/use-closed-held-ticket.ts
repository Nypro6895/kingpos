"use client";
import { useEffect, useRef } from "react";
import type { HeldVisitState } from "@/types/staff-scan";

// Only an authoritative successful desk snapshot may close the local editor.
// Network failures and a disabled workspace must retain all local work.
export function useClosedHeldTicket(options: {
  visitId?: string; blocked: boolean;
  read?: (visitId: string) => Promise<{ data?: HeldVisitState; error?: string }>;
  close: () => void;
}) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  useEffect(() => {
    if (!options.visitId || !options.read) return;
    let alive = true, checking = false;
    async function check() {
      const current = latest.current;
      if (!alive || checking || current.blocked || !current.visitId || !current.read) return;
      checking = true;
      try {
        const result = await current.read(current.visitId);
        if (alive && !latest.current.blocked && latest.current.visitId === current.visitId && !result.error && result.data?.visitId === current.visitId && (result.data.completed || result.data.cancelled)) latest.current.close();
      } catch { /* The draft remains available while offline. */ }
      finally { checking = false; }
    }
    const timer = setInterval(() => { void check(); }, 15000);
    const initial = setTimeout(() => { void check(); }, 0);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => { alive = false; clearInterval(timer); clearTimeout(initial); window.removeEventListener("focus", check); window.removeEventListener("online", check); };
  }, [options.visitId, options.read]);
}
