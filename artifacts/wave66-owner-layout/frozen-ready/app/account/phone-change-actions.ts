"use server";
import { assertAbuseRequest, abuseServiceClient } from "@/lib/abuse-server";
import { isEmailProviderConfigured, sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { getSupabaseConfig } from "@/lib/supabase/server";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import { readPhoneChangeProof, writePhoneChangeProof } from "@/lib/account-phone-change";
export async function authorizePhoneChangeAction(input:{phone:string;code?:string}){
 try{
 const user=await getCurrentKingUser(),config=getSupabaseConfig();
 if(!user?.auth_user_id||!config)return {error:"Sign in again to change your phone."};
 if(!user.email)return {error:"An account email is required to verify this phone change. Contact support if you cannot access your old number."};
 const phone=input.phone.trim()?normalizePhoneForIdentity(input.phone):null;
 if(input.phone.trim()&&!phone)return {error:"Enter a valid phone number."};
 await assertAbuseRequest("recovery",user.email);
 const client=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 if(!input.code){
 await writePhoneChangeProof(user,phone,false);
 if(!isEmailProviderConfigured())return {error:"Email verification is unavailable. Please try again later."};
 const {data,error}=await abuseServiceClient().auth.admin.generateLink({type:"magiclink",email:user.email});
 if(error||data.user.id!==user.auth_user_id||!data.properties.email_otp)return {error:"The code could not be sent. Please wait and try again."};
 const code=data.properties.email_otp;
 const delivered=await sendEmail({to:user.email,subject:"Verify your Reylumi phone change",text:`Your verification code is ${code}. Use it only to confirm your phone change in Settings. If you did not request this, ignore this email.`,html:`<p>Your verification code is <strong>${code}</strong>.</p><p>Use it only to confirm your phone change in Settings. If you did not request this, ignore this email.</p>`});
 return delivered.status!=="sent"?{error:"The code could not be sent. Please wait and try again."}:{error:null,sent:true};
 }
 if(!await readPhoneChangeProof(user,phone))return {error:"This request expired. Send a new code."};
 if(!/^\d{6,8}$/.test(input.code.trim()))return {error:"Enter the code from your email."};
 const {data,error}=await client.auth.verifyOtp({email:user.email,token:input.code.trim(),type:"email"});
 if(error||data.user?.id!==user.auth_user_id)return {error:"Invalid or expired code. Try again."};
 await writePhoneChangeProof(user,phone,true);
 return {error:null,verified:true};
 }catch{return {error:"Phone change verification is unavailable. Please try again later."};}
}
