"use client";

import { AuthIntentPrompt } from "@/components/auth-intent-prompt";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { useState } from "react";

type ShowcaseBookIntentProps = {
  availability: string;
  bookingHref: string;
  className?: string;
  duration: string;
  price: string;
  salonName: string;
  service: string;
};

export function ShowcaseBookIntent({
  availability,
  bookingHref,
  className = "",
  duration,
  price,
  salonName,
  service,
}: ShowcaseBookIntentProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={[
          "inline-flex min-h-12 items-center justify-center gap-2 rounded-[0.7rem] bg-brand-orange px-5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(242,111,61,0.2)] transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setOpen(true)}
        type="button"
      >
        <ReylumiIcon className="h-4 w-4" name="calendar" />
        Book this look - {price}
      </button>
      {open ? (
        <AuthIntentPrompt
          guestHref={bookingHref}
          guestLabel="Continue as guest"
          kicker="Book this look"
          onClose={() => setOpen(false)}
          showProviderOptions
          title={salonName}
        >
          <div className="grid gap-3">
            <div className="rounded-[0.9rem] bg-surface-muted p-3 ring-1 ring-divider-subtle/70">
              <p className="text-sm font-semibold text-text-primary">
                {service}
              </p>
              <p className="mt-1 text-xs font-semibold text-text-secondary">
                {price} · {duration} · {availability}
              </p>
            </div>
            <p>
              Create an account to save this look and book faster next time, or
              continue as a guest to browse service times.
            </p>
          </div>
        </AuthIntentPrompt>
      ) : null}
    </>
  );
}
