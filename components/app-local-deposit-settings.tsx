"use client";
import Link from"next/link";import{WorkspaceText}from"@/components/workspace-language";import{BookingDepositPanel}from"@/app/market/booking-deposit-panel";import styles from"@/app/market/booking-deposit-product.module.css";import type{AppLocalDepositSettings}from"@/lib/app-local-commerce-metadata";
export function AppLocalDepositSettingsView({salonId,state,query}:AppLocalDepositSettings&{query:{confirmed?:string;salon?:string}}){
return <main className={styles.settingsPage}>
    <Link className={styles.back} href="/market/booking-deposit">← <WorkspaceText text="Back to plugin" /></Link>
    <h1>Booking Deposit</h1><p className={styles.settingsIntro}><WorkspaceText text="Choose how much customers pay when they book." /></p>
    {query.confirmed === "1" && <p className={styles.success} role="status"><WorkspaceText text="Payment successful. Booking Deposit has been added. Set your deposit below." /></p>}
    <BookingDepositPanel key={salonId} initial={state} salonId={salonId} settingsOnly />
  </main>;
}
