"use client";
import { useEffect, useState } from "react";
import type { BeautyProfileSummary } from "@/types/beauty";
import NextImage from "next/image";
import { BEAUTY_ALLOWED_IMAGE_TYPES, BEAUTY_IMAGE_LIMIT, encodeStoragePath } from "@/lib/beauty-media";
import { updateBeautyProfileAction, getBeautyMediaUploadSessionAction, deleteBeautyMediaAction } from "@/app/beauty/actions";
import { loadPersonalPublicProfileSettings } from "./personal-public-profile-actions";
import { InlineForm, Select, inputClass, buttonClass } from "./direct-settings-ui";
export function PersonalPublicProfilePanel() {
  const [profile,setProfile]=useState<BeautyProfileSummary|null>(null),[error,setError]=useState("");
  async function reload(){setProfile(await loadPersonalPublicProfileSettings());setError("");}
  useEffect(()=>{let active=true;loadPersonalPublicProfileSettings().then(p=>{if(active)setProfile(p);}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Your public profile could not be loaded.");});return()=>{active=false;};},[]);
  if(!profile)return <div>{error?<><p role="alert" className="text-sm text-red-700">{error}</p><button className={buttonClass} onClick={()=>void reload().catch(e=>setError(e instanceof Error?e.message:"Could not load your profile."))}>Retry</button></>:<p role="status">Loading public profile…</p>}</div>;
  return <InlineForm key={profile.bio+profile.visibility+profile.coverMediaPath} save={async form=>{
    let coverMediaPath:string|null=null;
    try{
      const removeCover=form.get('remove_cover')==='on',file=form.get('cover_image');
      if(!removeCover&&file instanceof File&&file.size){
        if(!BEAUTY_ALLOWED_IMAGE_TYPES.includes(file.type as typeof BEAUTY_ALLOWED_IMAGE_TYPES[number]))throw new Error('Use a JPEG, PNG or WebP cover image.');
        if(file.size>BEAUTY_IMAGE_LIMIT)throw new Error('Cover image must be 15 MB or smaller.');
        const session=await getBeautyMediaUploadSessionAction('cover');coverMediaPath=session.path;
        const response=await fetch(`${session.supabaseUrl}/storage/v1/object/${session.bucket}/${encodeStoragePath(session.path)}`,{method:'POST',headers:{Authorization:`Bearer ${session.accessToken}`,apikey:session.anonKey,'Content-Type':file.type,'x-upsert':'false'},body:file});
        if(!response.ok)throw new Error('The cover image could not be uploaded. Try again.');
      }
      const result=await updateBeautyProfileAction({bio:String(form.get("bio")||"").trim()||null,visibility:form.get("visibility")==="public"?"public":"self",coverMediaPath,removeCover});
      if(result.error)throw new Error(result.error);
      return {ok:true};
    }catch(e){if(coverMediaPath)await deleteBeautyMediaAction(coverMediaPath).catch(()=>{});return {ok:false,error:e instanceof Error?e.message:'Could not save your public profile.'};}
  }} onSaved={reload}>
    <p className="text-sm font-semibold">{profile.displayName}</p>
    <Select name="visibility" label="Public profile visibility" value={profile.visibility} options={[["public","Public"],["self","Only me"]]}/>
    {profile.coverImageUrl?<NextImage src={profile.coverImageUrl} alt="Current public profile cover" width={800} height={320} unoptimized className="max-h-48 w-full rounded-md object-cover"/>:null}
    <label className="grid gap-1 text-sm">Cover image<input name="cover_image" type="file" accept="image/jpeg,image/png,image/webp" className={inputClass}/></label>
    {profile.coverMediaPath?<label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove_cover"/>Remove saved cover image</label>:null}
    <label className="grid gap-1 text-sm">Bio<textarea name="bio" className={inputClass} rows={3} maxLength={500} defaultValue={profile.bio||""}/></label>
  </InlineForm>;
}
