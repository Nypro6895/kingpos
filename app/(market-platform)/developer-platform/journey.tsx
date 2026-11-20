import Link from "next/link";
import { developerJourney } from "@/lib/market-platform/journey";
import { PortalJump, DeveloperText } from "./sections";
import styles from "./platform.module.css";

export function DeveloperJourney({ input }: { input: Parameters<typeof developerJourney>[0] }) {
  return <>
    <h2><DeveloperText text="Your developer journey" /></h2>
    <p><DeveloperText text="Follow these steps from publisher setup to a reviewed app. Status reflects current workspace observations, not a product quality score or commercial release approval." /></p>
    <ol className={styles.journey}>{developerJourney(input).map(step => <li key={step.title}>
      <div className={styles.journeyHeading}><h3><DeveloperText text={step.title} /></h3><span data-status={step.status}><DeveloperText text={step.status} /></span></div>
      <p><DeveloperText text={step.detail} /></p><PortalJump panel={step.panel}><DeveloperText text="Open this step" /></PortalJump>
    </li>)}</ol>
    <article><h3><DeveloperText text="What your app can access today" /></h3><p><DeveloperText text="Hosted apps can request separate read scopes for Owner-published salon profile, services, selected photos and public content, in addition to salon identity. Data is not shared by default. Customer, staff, POS, payroll, payment and write APIs are not available. There is no executable package runtime or third-party single sign-on." /></p>
      <p><DeveloperText text="Owner flow: existing salon Market → approved version and permissions → activate → open and connect automatically → update with fresh consent or remove and revoke. Owners do not copy tokens." /></p>
      <Link href="/developer-platform/guide"><DeveloperText text="Read the full integration guide" /></Link> · <Link href="/market"><DeveloperText text="Open your salon’s Market" /></Link>
    </article>
    <article><h3><DeveloperText text="Payments require separate acceptance" /></h3><p><DeveloperText text="Reylumi collects and shares proceeds with sellers. Payments are test-only here; commission, fees, tax and refund/dispute responsibilities must be approved before live use. Sandbox or manifest checks do not verify provider settlement." /></p><PortalJump panel="commerce"><DeveloperText text="Open payment configuration" /></PortalJump></article>
  </>;
}
