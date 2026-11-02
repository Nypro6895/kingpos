import { NextRequest } from "next/server";
import { createAuthenticatedSupabaseServerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { getRewardPublicSalonContext } from "@/lib/reward-public-context";
export async function GET(request: NextRequest) {
  const headers={"Cache-Control":"no-store"};
  const id=request.nextUrl.searchParams.get("salonId");
  if(!id||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return Response.json({error:"Choose a valid salon."},{status:400,headers});
  try{
    const authenticatedDb=await createAuthenticatedSupabaseServerClient();
    const db=authenticatedDb??createSupabaseServerClient();
    const result=await db?.rpc("reward_public_program",{p_salon:id});
    if(!result||result.error)throw Error("Unavailable");
    if (!result.data?.salon) return Response.json({...result.data,authenticated:Boolean(authenticatedDb)},{headers});
    const context = await getRewardPublicSalonContext(db!,id);
    if (!context) return Response.json({salon:null,authenticated:Boolean(authenticatedDb)},{headers});
    return Response.json({...result.data,authenticated:Boolean(authenticatedDb),salon:{...result.data.salon,...context}},{headers});
  }catch{return Response.json({error:"Current rewards could not be loaded."},{status:503,headers});}
}
