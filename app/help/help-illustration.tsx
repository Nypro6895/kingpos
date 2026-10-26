"use client";
import type { HelpScreenshot } from "@/lib/help-guides";
import images from "@/lib/help-illustrations.json";
import { HelpText, HelpElement, useHelpLanguage } from "./help-language";
import styles from "./help.module.css";
type Pair = Pick<HelpScreenshot, "desktop" | "mobile">;
const localized: Record<string, Record<"en" | "vi", Pair>> = images;
export function HelpIllustration({ screen }: { screen: HelpScreenshot }) {
  const language = useHelpLanguage();
  const image = localized[screen.id]?.[language] ?? screen;
  return <figure className={styles.figure}>
    <picture><source media="(max-width: 720px)" srcSet={image.mobile.src} width={image.mobile.width} height={image.mobile.height} /><HelpElement as="img" src={image.desktop.src} width={image.desktop.width} height={image.desktop.height} alt={screen.alt} loading="lazy" decoding="async" /></picture>
    <figcaption><span className={styles.demoLabel}><HelpText text="Illustration" /></span><strong><HelpText text={screen.caption} /></strong><span className={styles.imageLinks}><a href={image.desktop.src}><HelpText text="View full desktop image" /></a><a href={image.mobile.src}><HelpText text="View full mobile image" /></a></span></figcaption>
  </figure>;
}
