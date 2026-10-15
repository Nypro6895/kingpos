"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useState } from "react";
import Image from "next/image";
import styles from "./market.module.css";

const previews = [
  { file: "create-ad", title: "Create your ad", caption: "Add your own photo and a few words, or promote a post you already shared.", alt: "Campaigns illustration showing a manicure photo, a headline and an ad message." },
  { file: "audience", title: "Choose your audience", caption: "Choose an area, a daily view limit and a duration. See the credit estimate before you continue.", alt: "Campaigns illustration showing Chicago, a 500-view daily limit and a three-day estimate of 300 credits." },
  { file: "results", title: "See your results", caption: "Follow views and activity in one place. Pause or cancel your ad whenever you need to.", alt: "Campaigns illustration showing sample views, likes, comments and bookings, with controls to pause or cancel." },
];

export function CampaignPreview() {
  const __vt = useWorkspaceTranslation();

  const [selected, setSelected] = useState(0);
  const current = previews[selected];
  const src = `/market/features/campaigns/${current.file}-v1.webp`;
  return <section className={styles.campaignPreview} aria-label={__vt("How Campaigns works")}>
    <div className={styles.previewChoices} role="tablist" aria-label={__vt("Campaigns preview steps")}>
      {previews.map((preview, index) => <button key={preview.file} id={`campaign-preview-tab-${index}`} role="tab" aria-selected={selected === index} aria-controls="campaign-preview-panel" tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % previews.length : event.key === "ArrowLeft" ? (index + previews.length - 1) % previews.length : event.key === "Home" ? 0 : event.key === "End" ? previews.length - 1 : null;
        if (next !== null) { event.preventDefault(); setSelected(next); document.getElementById(`campaign-preview-tab-${next}`)?.focus(); }
      }}><span>{index + 1}</span><WorkspaceText text={preview.title} /></button>)}
    </div>
    <figure id="campaign-preview-panel" role="tabpanel" aria-labelledby={`campaign-preview-tab-${selected}`} className={styles.previewFigure}>
      <Image src={src} alt={__vt(current.alt)} width={1536} height={1024} sizes="(max-width: 560px) 90vw, (max-width: 900px) 80vw, 800px" className={styles.previewImage} />
      <figcaption><strong><WorkspaceText text={current.title} /></strong><p><WorkspaceText text={current.caption} /></p><div className={styles.previewFoot}><span><WorkspaceText text="Illustrative preview. Sample results and prices may vary." /></span><a href={src} target="_blank" rel="noopener noreferrer"><WorkspaceText text="View full image ↗" /></a></div></figcaption>
    </figure>
  </section>;
}
