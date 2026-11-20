import Link from "next/link";

import type { PublisherProfile } from "@/lib/market-platform/developer-profile";
import { PlatformForm } from "./form";
import { PortalJump, DeveloperText, DeveloperPanelLink } from "./sections";
import styles from "./platform.module.css";

export function DeveloperAccountPanel({ organization, profile, available, publisherNameLocked }: {
  organization: { id: string; name: string } | null;
  profile?: PublisherProfile | null;
  available: boolean;
  publisherNameLocked?: boolean;
}) {
  return <>
    <div className={styles.accountToolbar}><h2><DeveloperText text="Profile & account security" /></h2></div>
    <p><DeveloperText text="Manage your public publisher profile separately from your personal sign-in and security settings." /></p>
    <div className={styles.accountGrid}>
      <article className={styles.accountCard}>
        <h3><DeveloperText text="Public publisher profile" /></h3>
        <p><DeveloperText text="Salons use this information to recognize your apps and contact support. Never enter passwords, tokens or bank details here." /></p>
        {!organization ? <><p><DeveloperText text="Create your developer organization before adding a publisher profile." /></p><PortalJump panel="developer"><DeveloperText text="Set up developer organization" /></PortalJump></> : !available || profile === undefined ? <div className={styles.accountNotice} role="status"><p><DeveloperText text="Publisher profile could not be loaded. Refresh before editing; no blank profile will be saved." /></p><DeveloperPanelLink panel="account"><DeveloperText text="Reload publisher profile" /></DeveloperPanelLink></div> : <PlatformForm key={organization.id} operation="profile" label="Save publisher profile">
          <label><DeveloperText text="Publisher name" /><input name="name" defaultValue={organization.name} minLength={2} maxLength={100} autoComplete="organization" required readOnly={publisherNameLocked !== false} aria-readonly={publisherNameLocked !== false} /></label>
          {publisherNameLocked === true && <p><DeveloperText text="The publisher name is locked after an approved version. Support contact details can still be updated." /></p>}
          {publisherNameLocked === undefined && <p role="status"><DeveloperText text="Publisher name change permission is unavailable. Reload before changing the name." /></p>}
          <label htmlFor="developer-support-email"><DeveloperText text="Support email" /><input id="developer-support-email" name="email" type="email" defaultValue={profile?.email ?? ""} required maxLength={254} autoComplete="email" aria-describedby="developer-support-email-help" /></label>
          <small id="developer-support-email-help"><DeveloperText text="Use a public support address, not a password or login credential." /></small>
          <label><DeveloperText text="Website" /><input name="website" type="url" defaultValue={profile?.website ?? ""} required placeholder="https://" pattern="https://.+" autoComplete="url" /></label>
          <label><DeveloperText text="About your organization" /><textarea name="description" maxLength={2000} defaultValue={profile?.description ?? ""} /></label>
          <p><DeveloperText text="Publisher information is separate from your private login and provider-hosted financial verification." /></p>
        </PlatformForm>}
      </article>
      <div className={styles.accountLinks}>
        <article className={styles.accountCard}><h3><DeveloperText text="Personal account" /></h3><p><DeveloperText text="Use the Reylumi account you already have. Your developer profile does not require another login." /></p><Link href="/account"><DeveloperText text="Edit personal profile" /></Link></article>
        <article className={styles.accountCard}><h3><DeveloperText text="Sign-in & security" /></h3><p><DeveloperText text="Manage your password, two-factor authentication, recovery and active sessions in Reylumi account settings." /></p><Link href="/settings/login-security"><DeveloperText text="Open account security" /></Link><p className={styles.accountHint}><DeveloperText text="Security status is shown in account settings. This page does not confirm that two-factor authentication is enabled." /></p></article>
        <article className={styles.accountCard}><h3><DeveloperText text="Need help getting connected?" /></h3><p><DeveloperText text="Follow the guide from app submission to Owner approval and automatic connection." /></p><Link href="/developer-platform/guide"><DeveloperText text="Introduction & integration guide" /></Link></article>
      </div>
    </div>
  </>;
}
