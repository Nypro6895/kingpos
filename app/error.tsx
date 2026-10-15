"use client";

import { AppStartupShell } from "@/components/app-startup-shell";

export default function AppError({ unstable_retry }: { unstable_retry: () => void }) {
  return <AppStartupShell retry={unstable_retry} />;
}
