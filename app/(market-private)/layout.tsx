import type { Metadata } from "next";
import type { ReactNode } from "react";
import styles from "@/components/market-registry/registry.module.css";

export const metadata: Metadata = {
  title: { default: "Market workspace | Reylumi", template: "%s | Reylumi" },
  robots: { index: false, follow: false },
};

export default function MarketPrivateLayout({ children }: { children: ReactNode }) {
  return <div className={styles.workspace}>
    <header className={styles.masthead}>
      <span className={styles.brand} aria-label="Reylumi">REY<span>LUMI</span></span>
      <span className={styles.privateBadge}>Private Market workspace</span>
    </header>
    <main className={styles.main}>{children}</main>
  </div>;
}
