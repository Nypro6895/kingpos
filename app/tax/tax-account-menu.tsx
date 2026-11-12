"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function TaxAccountMenu({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target) &&
        ref.current
      )
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details
      ref={ref}
      className="tax-account-menu"
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("a,button") &&
          ref.current
        )
          ref.current.open = false;
      }}
    >
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}
