"use client";

import Image from "next/image";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./market.module.css";

const imagePath = "/market/features/tax-company/owner-settings-v1.png";

export function TaxCompanyPreview() {
  const translate = useWorkspaceTranslation();
  return <section className={styles.campaignPreview} aria-label={translate("Tax Company owner settings preview")}>
    <figure className={styles.previewFigure}>
      <Image src={imagePath} alt={translate("Salon owner Tax Company settings showing salon ID, password controls and the connected tax professional’s name and account. Sample data.")} width={1080} height={770} sizes="(max-width: 560px) 90vw, 800px" className={styles.ownerPreviewImage} />
      <figcaption>
        <strong><WorkspaceText text="Salon owner settings" /></strong>
        <p><WorkspaceText text="Create your salon login, see who has tax access, change the password or disconnect connected accounts." /></p>
        <div className={styles.previewFoot}>
          <span><WorkspaceText text="Actual interface with sample data." /></span>
          <a href={imagePath} target="_blank" rel="noopener noreferrer"><WorkspaceText text="View full image ↗" /></a>
        </div>
      </figcaption>
    </figure>
  </section>;
}
