"use client";
import { useRef, useState, type ChangeEvent } from "react";
import type { Manifest } from "@/lib/market-platform/server";
import { inspectManifest, declaredManifestChanges, manifestLimitBytes, type ManifestPreflight } from "@/lib/market-platform/manifest-preflight";
import { publicScopeLabels } from "@/lib/market-platform/published-contract";
import { DeveloperText } from "./sections";
import styles from "./platform.module.css";

export function ManifestUpload({ apps }: { apps: { id: string; name: string; versions: { manifest: Manifest }[] }[] }) {
  const [app, setApp] = useState(apps.length ? "" : "__new__");
  const [result, setResult] = useState<ManifestPreflight | null>(null);
  const [reading, setReading] = useState(false);
  const generation = useRef(0);
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget, file = input.files?.[0], current = ++generation.current;
    setResult(null); setReading(false); input.setCustomValidity("");
    if (!file) return;
    input.setCustomValidity("Wait for the local manifest check to finish.");
    setReading(true);
    let checked: ManifestPreflight;
    try { checked = !file.name.endsWith(".json") || file.size < 1 || file.size > manifestLimitBytes ? { ok: false, errors: ["Choose a JSON manifest of at most 16 KiB."] } : inspectManifest(await file.text()); }
    catch { checked = { ok: false, errors: ["The file could not be read. Choose it again or select another JSON file."] }; }
    if (current !== generation.current) return;
    input.setCustomValidity(checked.ok ? "" : checked.errors.join(" "));
    setResult(checked); setReading(false);
  };
  const selected = apps.find(a => a.id === app);
  // A matching version reveals immutable-name reuse; otherwise compare the latest supplied submission.
  const previous = result?.ok ? selected?.versions.find(v => v.manifest.version === result.manifest.version)?.manifest ?? selected?.versions[0]?.manifest : undefined;
  const diff = result?.ok ? declaredManifestChanges(result.manifest, previous) : null;
  return <>
    <input type="hidden" name="app" value={app === "__new__" ? "" : app} />
    <label><DeveloperText text="App" /><select required value={app} onChange={e => setApp(e.target.value)}>
      <option value="" disabled><DeveloperText text="Choose an existing app or create a new one" /></option>
      <option value="__new__"><DeveloperText text="Create a new app" /></option>{apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select></label>
    {app === "__new__" && result?.ok && apps.some(a => a.name.trim().toLowerCase() === result.manifest.name.trim().toLowerCase()) && <p role="alert"><DeveloperText text="An app with this name already exists. To submit an update, select the existing app above. Creating a new app starts a separate history and connection." /></p>}
    <label><DeveloperText text="Connection manifest (.json, up to 16 KiB)" /><input type="file" name="manifest" accept=".json,application/json" required onChange={readFile} aria-describedby="manifest-preflight-note" /></label>
    <p id="manifest-preflight-note"><DeveloperText text="Checked locally before submission. No file is executed and no website is contacted. Server validation and independent review remain required." /></p>
    {reading && <p role="status"><DeveloperText text="Checking manifest…" /></p>}
    {result && !result.ok && <div role="alert"><ul>{result.errors.map(error => <li key={error}><DeveloperText text={error} /></li>)}</ul></div>}
    {result?.ok && diff && <aside className={styles.manifestPreview} aria-label="Local manifest preflight">
      <h3><DeveloperText text="Local manifest check passed" /></h3>
      <p>{result.manifest.name} · {result.manifest.version} · {(result.manifest.price.amountCents / 100).toFixed(2)} USD</p>
      <p><DeveloperText text={previous ? "Compared with submitted version" : "First submission: no previous version selected"} />{previous && <> · {previous.version}</>}</p>
      {diff.versionAlreadyUsed && <p role="status"><DeveloperText text="This version already exists. It is immutable; an identical retry may return the existing submission. Any change requires a new version." /></p>}
      <h4><DeveloperText text="Declared addresses" /></h4><ul>{(["launchUrl", "privacyUrl", "supportUrl"] as const).map(k => <li key={k}>{k}: <code>{result.manifest[k]}</code></li>)}</ul>
      {previous && <><h4><DeveloperText text="Connection declaration changes" /></h4><ul>{diff.urls.map(u => <li key={u.field}>{u.field}: <code>{u.previous}</code> → <code>{u.next}</code> · <DeveloperText text={u.originChanged ? "Origin changes" : "Address changes within the same origin"} /></li>)}{!diff.urls.length && <li><DeveloperText text="Declared addresses are unchanged; hosted code and domain ownership remain unverified." /></li>}<li><DeveloperText text={diff.priceChanged ? "Version price changes" : "Version price is unchanged"} /></li><li><DeveloperText text={diff.listingChanged ? "Listing text changes" : "Listing text is unchanged"} /></li></ul></>}
      <h4><DeveloperText text="Requested permissions" /></h4><ul>{result.manifest.scopes.map(s => <li key={s}><DeveloperText text={publicScopeLabels[s]} />{previous && <> · <DeveloperText text={diff.added.includes(s) ? "New request" : "Previously declared"} /></>}</li>)}{!result.manifest.scopes.length && <li><DeveloperText text="No salon data access" /></li>}</ul>
      {diff.removed.length > 0 && <><h4><DeveloperText text="Access no longer requested" /></h4><ul>{diff.removed.map(s => <li key={s}><DeveloperText text={publicScopeLabels[s]} /></li>)}</ul></>}
      <p><DeveloperText text="This check does not verify domain ownership, hosted code, privacy practices or product quality. A new version needs independent review and fresh Owner consent before replacing an installed version." /></p>
    </aside>}
  </>;
}
