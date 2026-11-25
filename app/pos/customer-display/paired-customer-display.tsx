"use client";

import { useMemo, useState } from "react";
import { CustomerDisplayClient, type CustomerDisplaySettings } from "./customer-display-client";
import { PairedCustomerActionsProvider } from "./paired-customer-actions-context";
import { createPairedDisplayTransport } from "@/lib/portable-workstation-client";
import type { PortableWorkstationSession } from "@/types/portable-workstation";
import type { CustomerVisitRequestedService } from "@/types/customer-visit";
import { WorkspaceText } from "@/components/workspace-language";
import styles from "@/app/pos/portable/portable-devices.module.css";

/** Retains the existing customer checkout UI; its authority is the pairing cookie. */
export function PairedCustomerDisplay({ session }: { session: PortableWorkstationSession }) {
  const id = session.current?.id ?? "";
  const [removed, setRemoved] = useState(false);
  const transport = useMemo(() => createPairedDisplayTransport(id, () => setRemoved(true)), [id]);
  const actions = useMemo(() => ({ command: transport.command }), [transport]);
  if (!id || session.role !== "customer" || !session.settings || !Array.isArray(session.serviceCatalog)) return null;
  if (removed) return <main className={styles.welcome}><section className={`${styles.entry} ${styles.pairForm}`} role="status">
    <h1><WorkspaceText text="This customer screen was removed or replaced." /></h1>
    <p><WorkspaceText text="Create a new connection code on the employee POS to reconnect this screen." /></p>
    <a className={styles.primary} href="/pos/portable/display"><WorkspaceText text="Connect this screen" /></a>
  </section></main>;
  return <PairedCustomerActionsProvider value={actions}><CustomerDisplayClient
    token={"workstation:" + id}
    settings={session.settings as CustomerDisplaySettings}
    serviceCatalog={session.serviceCatalog as CustomerVisitRequestedService[]}
    initialSnapshot={session.snapshot ? { ...session.snapshot, id: "welcome", token: "workstation:" + id, status: "draft", staff_lines: [], customer: null, subtotal: 0, total: 0, total_before_tip: 0, tax: 0, tip: 0, discount: 0, completed_at: null, reset_at: null, customer_handoff_started_at: null, settled_receipt: undefined } : null}
    transport={transport}
  /></PairedCustomerActionsProvider>;
}
