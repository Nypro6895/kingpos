import { NextResponse } from "next/server";
import { cookies } from "next/headers";
export async function POST(request: Request) {
  const url=new URL(request.url);
  if(request.headers.get('origin')!==url.origin)return new NextResponse(null,{status:403});
  const response=NextResponse.json({ok:true});
  const existing=(await cookies()).get('kingpos-workspace-device')?.value;
  if(!existing||!/^[a-f0-9-]{36}$/i.test(existing)) response.cookies.set('kingpos-workspace-device',crypto.randomUUID(),{httpOnly:true,sameSite:'lax',secure:url.protocol==='https:',path:'/',maxAge:31536000});
  return response;
}
