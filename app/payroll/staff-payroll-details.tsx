"use client";

import { createContext, useContext, useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useWorkspaceTranslation, WorkspaceText } from "@/components/workspace-language";
import styles from "./payroll-mobile.module.css";

const DetailsGroup = createContext<{ openId: string | null; setOpenId: Dispatch<SetStateAction<string | null>> } | null>(null);

/** Scoped to one payroll list, including pages retained by the navigation shell. */
export function StaffPayrollDetailsGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return <DetailsGroup.Provider value={{ openId, setOpenId }}>{children}</DetailsGroup.Provider>;
}

export function StaffPayrollDetails({ name, header, children }: { name: string; header: ReactNode; children: ReactNode }) {
  const group = useContext(DetailsGroup);
  const [localOpen, setLocalOpen] = useState(false);
  const id = useId();
  const t = useWorkspaceTranslation();
  const open = group ? group.openId === id : localOpen;
  return <section className={`${styles.staffCard} ${styles.takeHomeCard} ${styles.compactStaffCard}`} data-staff-payroll-row data-open={open}>
    <div className={styles.staffDetailsHeader}>
      {header}
      <button type="button" className={styles.staffDetailsButton} aria-expanded={open} aria-controls={id} aria-label={`${t("Details")} · ${name}`}
        onClick={() => group ? group.setOpenId(previous => previous === id ? null : id) : setLocalOpen(previous => !previous)}>
        <WorkspaceText text="Details" />
      </button>
    </div>
    {/* Keep forms mounted when another row opens; drafts/autosaves retain their existing lifecycle. */}
    <div id={id} hidden={!open}>{children}</div>
  </section>;
}
