"use client";

import { useFormStatus } from "react-dom";

export function CreateSalonSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-label="Create Salon"
      className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? "Creating salon..." : "Create Salon"}
    </button>
  );
}
