import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/pos/customer-display/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Reylumi Display",
    statusBarStyle: "default",
  },
};

export default function CustomerDisplayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
