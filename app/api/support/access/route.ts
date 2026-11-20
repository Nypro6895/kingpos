import {NextResponse} from "next/server";
import {validSupportEmailAccess} from "@/lib/support-email-access";
import {guestSupportToken} from "@/lib/guest-support";
export async function GET(request:Request) {
 const url=new URL(request.url);const id=url.searchParams.get("thread")||"";const expires=Number(url.searchParams.get("expires"));const signature=url.searchParams.get("signature")||"";
 if(!validSupportEmailAccess(id,expires,signature))return NextResponse.redirect(new URL("/contact-support?message=expired-link",url.origin),{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 const response=NextResponse.redirect(new URL(`/support/guest/${id}`,url.origin),{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 response.cookies.set(`support-case-${id}`,guestSupportToken(id),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*24*30});return response;
}
