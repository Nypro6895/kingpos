"use client";

import Image from "next/image";
import { useState } from "react";

export function CommentAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const safeUrl = avatarUrl && /^https?:\/\//i.test(avatarUrl) ? avatarUrl : null;
  return <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600">
    {safeUrl && failedUrl !== safeUrl
      ? <Image src={safeUrl} alt="" width={32} height={32} unoptimized className="size-full object-cover" onError={() => setFailedUrl(safeUrl)} />
      : name.slice(0, 2).toUpperCase()}
  </span>;
}
