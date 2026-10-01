"use client";

import { useFormStatus } from "react-dom";

type ReviewActionButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  variant: "primary" | "secondary";
};

export function ReviewActionButton({
  idleLabel,
  pendingLabel,
  variant,
}: ReviewActionButtonProps) {
  const { pending } = useFormStatus();
  const className =
    variant === "primary"
      ? "bg-zinc-950 text-white shadow-sm hover:bg-zinc-800 focus-visible:outline-zinc-950 disabled:bg-zinc-500"
      : "border border-zinc-300 bg-white text-zinc-800 hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-zinc-500 disabled:text-zinc-400";

  return (
    <button
      className={[
        "inline-flex min-h-12 w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70",
        className,
      ].join(" ")}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
