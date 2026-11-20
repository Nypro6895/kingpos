"use client";
import {useCallback,useState} from "react";
import {PlatformForm} from "./form";
import {DeveloperText} from "./sections";
export function ClientConfiguration({appId, configured}:{appId:string;configured:boolean|null}) {
  const [revealed,setRevealed]=useState(false);
  const markRevealed=useCallback(()=>setRevealed(true),[]);
  return <section aria-label="Confidential client configuration">
    <h4><DeveloperText text="Server connection" /></h4>
    <p role="status"><DeveloperText text={revealed?"Secret generated. Store it now, then reload to see current credential status.":configured===null?"Credential status unavailable. Refresh before generating or rotating a secret.":configured?"Client secret configured. Keep the secret on your app server; it cannot be shown again.":"No client secret configured. Generate one to connect your backend."} /></p>
    {configured!==null && <PlatformForm operation="client" onCredential={markRevealed} label={configured?"Rotate client secret":"Generate client secret"} danger={configured}>
      <input type="hidden" name="app" value={appId} />
      {configured && <p><DeveloperText text="Rotation immediately revokes current app connections. Owners must reconnect from Market. Schedule this change with affected salons." /></p>}
      <label><input name="confirm" type="checkbox" value="yes" required /><DeveloperText text={configured?"I understand that rotation revokes existing connections.":"I will store this one-time secret securely on my backend."} /></label>
    </PlatformForm>}
  </section>;
}
