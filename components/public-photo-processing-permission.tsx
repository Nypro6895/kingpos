"use client";

import { useCallback, useId, useState } from "react";
import {
  PUBLIC_PHOTO_PROCESSING_CHECKBOX_LABEL,
  PUBLIC_PHOTO_PROCESSING_DECLINE_NOTICE,
  PUBLIC_PHOTO_PROCESSING_NOTICE,
  PUBLIC_PHOTO_PROCESSING_NOTICE_VERSION,
  PUBLIC_PHOTO_PROCESSING_PRIVACY_HREF,
  type PublicPhotoProcessingConsent,
} from "@/lib/public-photo-processing-consent";

/** In-memory choice for this composer/photo scope, never an account preference. */
export function usePublicPhotoProcessingPermission(scope: string) {
  const [choice, setChoice] = useState({ scope, accepted: false });
  // Guarded state adjustment records every committed scope synchronously. An
  // A -> B -> A roundtrip must not resurrect A's choice before effects run.
  if (choice.scope !== scope) setChoice({ scope, accepted: false });
  const accepted = choice.scope === scope && choice.accepted;
  const setAccepted = useCallback((value: boolean) => setChoice({ scope, accepted: value === true }), [scope]);
  const reset = useCallback(() => setChoice({ scope, accepted: false }), [scope]);
  const consent: PublicPhotoProcessingConsent | undefined = accepted ? {
    provider: "openai", noticeVersion: PUBLIC_PHOTO_PROCESSING_NOTICE_VERSION, accepted: true,
  } : undefined;
  return { accepted, consent, reset, setAccepted };
}

export function PublicPhotoProcessingPermission({ accepted, disabled = false, onChange }: {
  accepted: boolean;
  disabled?: boolean;
  onChange: (accepted: boolean) => void;
}) {
  const id = useId();
  return <section aria-labelledby={`${id}-title`} className="grid gap-3 border-t border-zinc-100 pt-4 text-sm leading-6 text-text-primary">
    <h3 className="font-semibold" id={`${id}-title`}>Photo safety check</h3>
    <p className="text-text-secondary" id={`${id}-notice`}>{PUBLIC_PHOTO_PROCESSING_NOTICE}</p>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1" htmlFor={`${id}-choice`}>
      <input aria-describedby={`${id}-notice ${id}-decline`} checked={accepted} className="mt-1 size-5 shrink-0 accent-brand-orange" disabled={disabled}
        id={`${id}-choice`} onChange={event => onChange(event.currentTarget.checked)} type="checkbox" />
      <span>{PUBLIC_PHOTO_PROCESSING_CHECKBOX_LABEL}</span>
    </label>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs leading-5 text-text-secondary">
      <p className="min-w-0 flex-1" id={`${id}-decline`}>{PUBLIC_PHOTO_PROCESSING_DECLINE_NOTICE}</p>
      <a className="inline-flex min-h-11 items-start py-1 text-brand-orange underline underline-offset-2" href={PUBLIC_PHOTO_PROCESSING_PRIVACY_HREF} rel="noopener noreferrer" target="_blank">Privacy</a>
    </div>
  </section>;
}
