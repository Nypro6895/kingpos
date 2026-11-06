import Link from "next/link";
import { HelpText as WorkspaceText, HelpElement as WorkspaceElement, HelpRoot, HelpLink, HelpLanguageSelector } from "./help-language";
import { helpGroupFor, relatedHelpGuides, type HelpGuide, type HelpScreenshot } from "@/lib/help-guides";
import { isHelpAvailable } from "@/lib/help-draft";
import type { HelpLanguage } from "@/lib/help-language";
import { HelpCatalog } from "./help-catalog";
import styles from "./help.module.css";

export function HelpSupportEntry() {
  if (!isHelpAvailable()) return null;
  return <p className="mb-6 text-sm"><Link href="/help" prefetch={false} className={styles.supportLink}><WorkspaceText text="Browse the Help guides" /></Link></p>;
}
export function HelpHome({language}: {language?: HelpLanguage} = {}) {
  return <HelpRoot className={styles.shell} language={language}>
    <header className={styles.homeHeader}><h1><WorkspaceText text="Help" /></h1><HelpLanguageSelector /></header>
    <HelpCatalog />
    <p className={styles.support}><HelpLink href="/support?from=%2Fhelp" prefetch={false}><WorkspaceText text="Contact support" /></HelpLink></p>
  </HelpRoot>;
}
export function HelpArticle({ guide, language }: { guide: HelpGuide; language?: HelpLanguage }) {
  const group = helpGroupFor(guide.slug);
  const related = relatedHelpGuides(guide);
  const inlineIds = new Set(guide.sections.flatMap(section => section.illustrationId ? [section.illustrationId] : []));
  const remainingScreens = guide.evidence.screenshots.filter(screen => !inlineIds.has(screen.id));
  return <HelpRoot className={styles.shell} language={language}>
    <div className={styles.articleTop}><HelpLink className={styles.back} href="/help" prefetch={false}>← <WorkspaceText text="Back to Help" /></HelpLink><HelpLanguageSelector /></div>
    {group ? <p className={styles.groupLabel}><WorkspaceText text={group.title}/></p> : null}
    <header className={styles.hero}><h1><WorkspaceText text={guide.title} /></h1><p><WorkspaceText text={guide.summary} /></p></header>
    <WorkspaceElement as="nav" aria-label="Guide contents" className={styles.contents}>
      <a href="#steps"><WorkspaceText text="Quick start" /></a><a href="#walkthroughs"><WorkspaceText text="Tasks" /></a>{related.length ? <a href="#related"><WorkspaceText text="Related guides" /></a> : null}
    </WorkspaceElement>
    <section id="before-start" className={styles.prerequisite} aria-labelledby="before-heading">
      <h2 id="before-heading"><WorkspaceText text="Before you start" /></h2><p><WorkspaceText text={guide.prerequisite} /></p>
      <Link className={styles.action} href={guide.entry.href} prefetch={false}><WorkspaceText text={guide.entry.label} /> <span aria-hidden="true">↗</span></Link>
    </section>
    <section id="steps" className={styles.section} aria-labelledby="steps-heading">
      <h2 id="steps-heading"><WorkspaceText text="Quick start" /></h2>
      <ol className={styles.steps}>{guide.steps.map((step, index) => <li key={step.title}><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><div><h3><WorkspaceText text={step.title} /></h3><p><WorkspaceText text={step.body} /></p></div></li>)}</ol>
    </section>
    <section id="walkthroughs" className={styles.section} aria-labelledby="walkthroughs-heading">
      <h2 id="walkthroughs-heading"><WorkspaceText text="Tasks" /></h2>
      {guide.sections.map(section => <details id={section.id} key={section.id} className={styles.walkthrough}>
        <summary><WorkspaceText text={section.title} /></summary>
        <ol>{section.steps.map(step => <li key={step}><WorkspaceText text={step} /></li>)}</ol>
        <p className={styles.result}><strong><WorkspaceText text="Result" />: </strong><WorkspaceText text={section.check} /></p>
        <details className={styles.details}><summary><WorkspaceText text="Example & common problems" /></summary><p className={styles.example}><WorkspaceText text={section.example} /></p><ul>{section.issues.map(issue => <li key={issue}><WorkspaceText text={issue} /></li>)}</ul></details>
        {section.illustrationId ? <details className={styles.details}><summary><WorkspaceText text="Screen illustrations"/></summary>{guide.evidence.screenshots.filter(screen => screen.id === section.illustrationId).map(screen => <HelpIllustration key={screen.id} screen={screen} />)}</details> : null}
      </details>)}
    </section>
    {guide.notes.length ? <details className={styles.details}><summary><WorkspaceText text="More details" /></summary><ul>{guide.notes.map(note => <li key={note}><WorkspaceText text={note} /></li>)}</ul></details> : null}
    {remainingScreens.length ? <details id="screenshots" className={styles.details}><summary><WorkspaceText text="Screen illustrations" /></summary><div className={styles.screens}>{remainingScreens.map(screen => <HelpIllustration key={screen.id} screen={screen} />)}</div></details> : null}
    <footer className={styles.articleFooter}>
      {related.length ? <section id="related" className={styles.related} aria-labelledby="related-heading"><h2 id="related-heading"><WorkspaceText text="Related guides"/></h2><ul>{related.map(item => <li key={item.slug}><HelpLink href={`/help/${item.slug}`} prefetch={false}><WorkspaceText text={item.title}/><span aria-hidden="true">›</span></HelpLink></li>)}</ul></section> : null}
      <p><Link href={`/support?from=${encodeURIComponent(`/help/${guide.slug}`)}`} prefetch={false}><WorkspaceText text="Contact support" /></Link></p>
    </footer>
  </HelpRoot>;
}

function HelpIllustration({ screen }: { screen: HelpScreenshot }) {
  return <figure className={styles.figure}>
    <picture><source media="(max-width: 720px)" srcSet={screen.mobile.src} width={screen.mobile.width} height={screen.mobile.height} /><WorkspaceElement as="img" src={screen.desktop.src} width={screen.desktop.width} height={screen.desktop.height} alt={screen.alt} loading="lazy" decoding="async" /></picture>
    <figcaption><span className={styles.demoLabel}><WorkspaceText text="Illustration" /></span><strong><WorkspaceText text={screen.caption} /></strong><span className={styles.imageLinks}><a href={screen.desktop.src}><WorkspaceText text="View full desktop image" /></a><a href={screen.mobile.src}><WorkspaceText text="View full mobile image" /></a></span></figcaption>
  </figure>;
}
