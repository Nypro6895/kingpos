"use client";

import { useEffect, useRef, useState } from "react";
import { automaticallyConsolidateCustomers } from "./actions";
import { WorkspaceText } from "@/components/workspace-language";

export function AutomaticCustomerMerge({ salonId }: { salonId: string }) {
  const started = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const key = `${salonId}:${attempt}`;
    if (started.current === key) return;
    started.current = key;
    let cancelled = false;
    async function run() {
      try {
        let result;
        do {
          result = await automaticallyConsolidateCustomers();
          if (cancelled) return;
          setError(result.error);
        } while (!result.error && result.merged >= 100);
      } catch {
        if (!cancelled) setError("Automatic customer merge could not finish. Please retry.");
      }
    }
    void run();
    return () => { cancelled = true; started.current = null; };
  }, [salonId, attempt]);
  if (!error) return null;
  return <p role="status" className="py-2 text-sm text-amber-800"><WorkspaceText text={error} />{" "}<button type="button" className="underline" onClick={() => { setError(null); setAttempt(value => value + 1); }}><WorkspaceText text="Retry" /></button></p>;
}
