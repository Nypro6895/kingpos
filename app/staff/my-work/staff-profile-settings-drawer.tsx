"use client";

import { StaffPublicProfileEditor } from "@/app/staff/staff-public-profile-editor";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Staff } from "@/types/staff";

export function StaffProfileSettingsDrawer({
  avatarUrl,
  closeHref,
  displayName,
  staff,
}: {
  avatarUrl: string | null;
  closeHref: string;
  displayName: string;
  staff: Staff;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  function close() {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close Staff Profile settings"
        className="absolute inset-0 bg-zinc-950/30"
        onClick={close}
        type="button"
      />
      <aside
        aria-modal="true"
        className="absolute right-0 top-0 flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white shadow-xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-zinc-950">
              Staff Profile
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Set the salon-specific name and photo customers see around the
              salon.
            </p>
          </div>
          <button
            aria-label="Close Staff Profile settings"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950"
            onClick={close}
            type="button"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-6 sm:py-5">
          <StaffPublicProfileEditor
            avatarUrl={avatarUrl}
            bio={staff.public_bio}
            displayName={displayName}
            jobTitle={staff.job_title}
            specialties={staff.specialties}
            staffId={staff.id}
          />
        </div>
      </aside>
    </div>
  );
}
