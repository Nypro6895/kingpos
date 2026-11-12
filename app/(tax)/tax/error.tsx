"use client";
import Link from "next/link";
export default function TaxError({ reset }: { reset: () => void }) {
  return (
    <main className="tax-auth">
      <span className="tax-brand">
        ReyLUMI <span>Tax</span>
      </span>
      <h1>Your workspace could not load</h1>
      <p>
        Check your connection and try again. Your saved business records are
        unchanged.
      </p>
      <div className="tax-actions">
        <button className="tax-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/tax">My businesses</Link>
      </div>
    </main>
  );
}
