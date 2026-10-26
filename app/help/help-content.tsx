import { HelpLink as Link, HelpShell } from "./help-language";
import { HelpIllustration } from "./help-illustration";
import type { HelpLanguage } from "@/lib/help-language";
import { HelpText as WorkspaceText, HelpElement as WorkspaceElement } from "./help-language";
import { HELP_GUIDES, HELP_QUICK_STARTS, findHelpGuide, type HelpGuide } from "@/lib/help-guides";
import { isHelpAvailable } from "@/lib/help-draft";
import { HelpCatalog } from "./help-catalog";
import styles from "./help.module.css";

export function HelpSupportEntry() {
  if (!isHelpAvailable()) return null;
  return <p className="mb-6 text-sm"><Link href="/help" prefetch={false} className="font-semibold text-orange-800 underline underline-offset-4"><WorkspaceText text="Browse the Help guides" /></Link></p>;
}
export function HelpHome({ language = "en" }: { language?: HelpLanguage }) {
  return <HelpShell language={language}>
    <header className={styles.hero}><h1><WorkspaceText text="Reylumi Help" /></h1><p><WorkspaceText text="Follow the guides in order, or jump to the task you need." /></p></header>
    
    <section className={styles.section} aria-labelledby="quick-start-heading">
      <h2 id="quick-start-heading"><WorkspaceText text="Choose a quick start" /></h2>
      <div className={styles.roles}>
        {HELP_QUICK_STARTS.map(role => <section key={role.id} className={styles.card}>
          <h3><WorkspaceText text={role.title} /></h3><p><WorkspaceText text={role.summary} /></p>
          <ol>{role.slugs.map(slug => {const guide = findHelpGuide(slug); return guide ? <li key={slug}><Link href={`/help/${slug}`} prefetch={false}><WorkspaceText text={guide.title} /></Link></li> : null;})}</ol>
        </section>)}
      </div>
    </section>
    <aside className={styles.ownerStart}><h2><WorkspaceText text="Owner Tips: run your first salon day" /></h2><p><WorkspaceText text="From opening POS to checking the money at the end of the day." /></p><Link href="/help/owner-tips" prefetch={false}><WorkspaceText text="Open the owner walkthrough" /></Link></aside>
    <HelpCatalog />
    <aside className={styles.planned}><h2><WorkspaceText text="Planned: Rewards" /></h2><p><WorkspaceText text="Rewards is a research item. There is no verified usage guide or launch commitment here." /></p></aside>
    <p className={styles.support}><Link href="/support?from=%2Fhelp" prefetch={false}><WorkspaceText text="Contact support" /></Link></p>
  </HelpShell>;
}
export function HelpArticle({ guide, language = "en" }: { guide: HelpGuide; language?: HelpLanguage }) {
  const nextGuide = HELP_GUIDES[HELP_GUIDES.indexOf(guide) + 1];
  const inlineIds = new Set(guide.sections.flatMap(section => section.illustrationId ? [section.illustrationId] : []));
  const remainingScreens = guide.evidence.screenshots.filter(screen => !inlineIds.has(screen.id));
  return <HelpShell language={language}>
    <Link className={styles.back} href="/help" prefetch={false}>← <WorkspaceText text="Back to all guides" /></Link>
    <header className={styles.hero}><h1><WorkspaceText text={guide.title} /></h1><p><WorkspaceText text={guide.summary} /></p></header>
    <WorkspaceElement as="nav" aria-label="Guide contents" className={styles.contents}>
      <a href="#before-start"><WorkspaceText text="Before you start" /></a><a href="#steps"><WorkspaceText text="Step by step" /></a><a href="#walkthroughs"><WorkspaceText text="Detailed walkthroughs" /></a>
    </WorkspaceElement>
    <section id="before-start" className={styles.prerequisite} aria-labelledby="before-heading">
      <h2 id="before-heading"><WorkspaceText text="Before you start" /></h2><p><WorkspaceText text={guide.prerequisite} /></p>
      <Link className={styles.action} href={guide.entry.href} prefetch={false}><WorkspaceText text={guide.entry.label} /> <span aria-hidden="true">↗</span></Link>
    </section>
    <section id="steps" className={styles.section} aria-labelledby="steps-heading">
      <h2 id="steps-heading"><WorkspaceText text="Step by step" /></h2>
      <ol className={styles.steps}>{guide.steps.map((step, index) => <li key={step.title}><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><div><h3><WorkspaceText text={step.title} /></h3><p><WorkspaceText text={step.body} /></p></div></li>)}</ol>
    </section>
    <section id="walkthroughs" className={styles.section} aria-labelledby="walkthroughs-heading">
      <h2 id="walkthroughs-heading"><WorkspaceText text="Detailed walkthroughs" /></h2>
      <WorkspaceElement as="nav" className={styles.sectionLinks} aria-label="Article sections">{guide.sections.map(section => <a href={`#${section.id}`} key={section.id}><WorkspaceText text={section.title} /></a>)}</WorkspaceElement>
      {guide.sections.map(section => <section id={section.id} key={section.id} className={styles.walkthrough} aria-labelledby={`heading-${section.id}`}>
        <h3 id={`heading-${section.id}`}><WorkspaceText text={section.title} /></h3>
        <ol>{section.steps.map(step => <li key={step}><WorkspaceText text={step} /></li>)}</ol>
        {section.illustrationId ? guide.evidence.screenshots.filter(screen => screen.id === section.illustrationId).map(screen => <HelpIllustration key={screen.id} screen={screen} />) : null}
        <p className={styles.result}><strong><WorkspaceText text="Check the result" />: </strong><WorkspaceText text={section.check} /></p>
        <p className={styles.example}><strong><WorkspaceText text="Example" />: </strong><WorkspaceText text={section.example} /></p>
        <details className={styles.details}><summary><WorkspaceText text="If something goes wrong" /></summary><ul>{section.issues.map(issue => <li key={issue}><WorkspaceText text={issue} /></li>)}</ul></details>
      </section>)}
    </section>
    {guide.notes.length ? <details className={styles.details}><summary><WorkspaceText text="Details and common questions" /></summary><ul>{guide.notes.map(note => <li key={note}><WorkspaceText text={note} /></li>)}</ul></details> : null}
    {remainingScreens.length ? <section id="screenshots" className={styles.section} aria-labelledby="screenshots-heading"><h2 id="screenshots-heading"><WorkspaceText text="Screen illustrations" /></h2><div className={styles.screens}>{remainingScreens.map(screen => <HelpIllustration key={screen.id} screen={screen} />)}</div></section> : null}
    <footer className={styles.articleFooter}>
      <p><WorkspaceText text="Need help with this task?" /> <Link href={`/support?from=${encodeURIComponent(`/help/${guide.slug}`)}`} prefetch={false}><WorkspaceText text="Contact support" /></Link></p>
      {nextGuide ? <p><WorkspaceText text="Continue learning" />: <Link href={`/help/${nextGuide.slug}`} prefetch={false}><WorkspaceText text={nextGuide.title} /></Link></p> : null}
    </footer>
  </HelpShell>;
}

