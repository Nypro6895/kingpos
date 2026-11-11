import {NextResponse} from "next/server";
import {adminIdentityClient} from "@/lib/platform-admin/user-identity";
export async function POST(request:Request) {
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return NextResponse.json({error:"Use the password reset page on this website."},{status:403});
 const token=request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
 if(!token)return NextResponse.json({error:"Use a valid password reset link."},{status:401});
 let input:{password?:unknown};
 try {const reader=request.body?.getReader();if(!reader)throw Error();let size=0;const chunks:Uint8Array[]=[];while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();throw Error();}chunks.push(part.value);}input=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return NextResponse.json({error:"Invalid password request."},{status:400});}
 const password=input?.password;
 if(typeof password!=="string"||password.length<8||password.length>128)return NextResponse.json({error:"Use a password between 8 and 128 characters."},{status:400});
 try {
 const service=adminIdentityClient();const identity=await service.auth.getUser(token);
 if(identity.error||!identity.data.user)return NextResponse.json({error:"This reset session is invalid or expired."},{status:401});
 let sessionId:string;
 try{const payload=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8"));sessionId=payload.session_id;if(payload.sub!==identity.data.user.id||typeof sessionId!=="string"||!/^[a-f0-9-]{36}$/i.test(sessionId))throw Error();}catch{return NextResponse.json({error:"Use a new password reset link."},{status:401});}
 const liveSession=await service.rpc("recovery_reset_session_valid",{p_auth_id:identity.data.user.id,p_session_id:sessionId});
 if(liveSession.error)return NextResponse.json({error:"Reset session could not be checked. Try again later."},{status:503});
 if(liveSession.data!==true)return NextResponse.json({error:"This reset session was revoked. Request a new reset link."},{status:401});
 const profile=await service.from("users").select("status").eq("auth_user_id",identity.data.user.id).maybeSingle();
 if(profile.error)return NextResponse.json({error:"Account status is temporarily unavailable."},{status:503});
 if(profile.data&&["pending_deletion","deleted","inactive","suspended"].includes(profile.data.status))return NextResponse.json({error:"Contact support to review this account's access before resetting its password."},{status:403});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return NextResponse.json({error:"Password reset is temporarily unavailable."},{status:503});
 // Use the customer's bearer token, never admin updateUserById, to change their password.
 const changed=await fetch(`${url}/auth/v1/user`,{method:"PUT",headers:{Authorization:`Bearer ${token}`,apikey:key,"Content-Type":"application/json"},body:JSON.stringify({password}),signal:AbortSignal.timeout(20000)});
 if(!changed.ok)return NextResponse.json({error:"The password could not be updated. Check the reset link and password requirements."},{status:changed.status===401?401:400});
 const updated=await changed.json();if(updated.id!==identity.data.user.id)return NextResponse.json({error:"Password update could not be confirmed. Contact support."},{status:503});
 const tracked=await service.rpc("record_recovery_password_change",{p_auth_id:identity.data.user.id});
 await service.auth.admin.signOut(token,"global");
 return NextResponse.json({ok:true,recoveryTrackingPending:Boolean(tracked.error)},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"The password update result could not be confirmed. Try signing in with your new password before requesting another reset."},{status:503});}
}
