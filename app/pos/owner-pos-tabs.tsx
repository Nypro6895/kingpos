import Link from "next/link";
export function OwnerPosTabs({active}:{active:"pos"|"settings"}) {
 const settings=active==='pos';
 return <nav aria-label="Owner POS"><Link className="owner-switch" href={settings?'/pos/settings':'/pos'} aria-label={settings?'Settings':'Back to POS'} title={settings?'Settings':'Back to POS'}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{settings?<><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></>:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M8 9h8m-4-2v4"/></>}</svg></Link></nav>;
}
