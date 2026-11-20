"use client";

import { useId, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { salonMapEmbedUrl } from "@/lib/location/map-links";

export function SalonLocationMap({ address, name }: { address: string; name: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const translate = useWorkspaceTranslation();
  const src = salonMapEmbedUrl(address);
  if (!src) return null;
  return <div className="mt-3 grid min-w-0 gap-2">
    <button className="inline-flex min-h-11 w-fit items-center rounded-full border border-zinc-200 px-3 text-sm font-semibold text-zinc-800" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <WorkspaceText text={open ? "Hide map" : "View map"} />
    </button>
    <div id={id} hidden={!open}>
      {open ? <iframe className="h-64 w-full rounded-xl border-0" title={`${translate("Map")} · ${name}`} src={src} loading="lazy" referrerPolicy="no-referrer" allowFullScreen /> : null}
    </div>
  </div>;
}
