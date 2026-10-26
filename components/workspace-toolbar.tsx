import { WorkspaceText } from "@/components/workspace-language";
import type { ReactNode } from "react";
import styles from "./workspace-toolbar.module.css";
export { default as toolbarStyles } from "./workspace-toolbar.module.css";
export function FilterIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M7 12h10M10 17h4" /></svg>;
}
export function WorkspaceToolbar({ title, children }: { title?: string; children: ReactNode }) {
  return <header className={styles.toolbar}>{title && <h1 className={styles.title}><WorkspaceText text={title} /></h1>}<div className={styles.actions}>{children}</div></header>;
}
