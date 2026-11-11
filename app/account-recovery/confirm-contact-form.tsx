"use client";
import {useActionState} from "react";
import {confirmRecoveryContact} from "@/app/account-recovery/verify-contact-actions";
export function ConfirmRecoveryContactForm({token}:{token:string}) {
 const [state,action,pending]=useActionState(async (_previous:{ok:boolean;message:string},form:FormData)=>confirmRecoveryContact(form),{ok:false,message:""});
 return <form action={action} className="mt-5 grid gap-4"><input name="token" type="hidden" value={token}/>{!state.ok&&<button disabled={pending} className="min-h-12 rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white">{pending?"Verifying…":"Confirm my contact email"}</button>}{state.message&&<p role={state.ok?"status":"alert"} className="text-sm leading-6">{state.message}</p>}</form>;
}
