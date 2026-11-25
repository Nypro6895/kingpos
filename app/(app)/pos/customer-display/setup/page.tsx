import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/pos/portable/manifest.webmanifest",
  appleWebApp: {capable:true,title:"Reylumi POS",statusBarStyle:"default"},
};

/** Legacy setup links enter the same installable Portable scope as every device. */
export default function CustomerDisplaySetupPage() {
  redirect("/pos/portable/display");
}
