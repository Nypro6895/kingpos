"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./rewardlumi.module.css";
import { rewardMoney } from "@/types/rewardlumi";
export function RewardsNearby({ latitude, longitude }: { latitude?: number | null; longitude?: number | null }) {
  const [salons, setSalons] = useState<{ id: string; name: string; city: string; distanceKm: number; spendCents: string; spendPoints: string }[]>([]);
  useEffect(() => {
    setSalons([]); if (latitude == null || longitude == null) return;
    const controller = new AbortController();
    fetch(`/api/rewards/nearby?lat=${latitude}&lon=${longitude}`, { signal: controller.signal }).then(r => r.ok ? r.json() : []).then(d => { if (!controller.signal.aborted && Array.isArray(d)) setSalons(d); }).catch(() => {});
    return () => controller.abort();
  }, [latitude, longitude]);
  if (!salons.length) return null;
  return <section className={styles.panel} aria-label="Rewards nearby"><h2>Rewards nearby</h2><p className={styles.muted}>Participating salons near your selected area.</p>{salons.map(s => <div className={styles.row} key={s.id}><span><strong>{s.name}</strong><br /><small>{s.distanceKm} km · {s.spendPoints} points per {rewardMoney(Number(s.spendCents))}</small></span><Link href={`/explore/salons/${s.id}`}>View salon</Link></div>)}</section>;
}
