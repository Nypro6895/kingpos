"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { SecurityChallenge, type SecurityChallengeHandle } from "@/components/security-challenge";

export function SecurityCheck() {
  const [complete, setComplete] = useState(false);
  const securityCheck = useRef<SecurityChallengeHandle>(null);

  if (complete) return (
    <div className="mt-6 grid gap-4">
      <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">Verified. You can now try your action again.</p>
      <button onClick={() => history.back()} className="min-h-11 rounded-lg border p-3">Return to previous page</button>
      <Link href="/explore" className="text-center underline">Explore</Link>
    </div>
  );

  return (
    <form className="mt-6 min-w-0" onSubmit={event => { event.preventDefault(); void securityCheck.current?.verify(); }}>
      <SecurityChallenge ref={securityCheck} onVerified={() => setComplete(true)} />
    </form>
  );
}
