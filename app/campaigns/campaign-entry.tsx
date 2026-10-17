"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceText } from "@/components/workspace-language";
import { PluginActivationDialog } from "@/app/settings/plugin-activation-dialog";
import styles from "./campaign-ui.module.css";
export function CampaignActivation() {
  const [open,setOpen]=useState(false);
  return <main className={styles.page}><header className={styles.heading}><h1><WorkspaceText text="Your salon, discovered"/></h1><p><WorkspaceText text="Create an ad so more customers discover your salon."/></p></header><label className={styles.toggleOff}><WorkspaceText text="Activate advertising for your salon"/><input type="checkbox" role="switch" checked={false} onChange={()=>setOpen(true)}/></label><PluginActivationDialog open={open} onClose={()=>setOpen(false)} pluginName="Campaigns" marketHref="/market?q=Campaigns&activate=campaigns&returnTo=campaigns"/></main>;
}
export function CampaignLoadError() {
  const router=useRouter(),[pending,start]=useTransition();
  return <main className={styles.page}><header className={styles.heading}><h1><WorkspaceText text="Your salon, discovered"/></h1></header><section className={styles.section}><p role="alert"><WorkspaceText text="Advertising could not load right now. Your ads and credits have not been changed."/></p><button className={styles.button} disabled={pending} onClick={()=>start(()=>router.refresh())}><WorkspaceText text={pending?"Loading…":"Try again"}/></button></section></main>;
}
