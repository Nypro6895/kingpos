import {NextResponse} from 'next/server';
import {headers} from 'next/headers';
import {loadOwnerCheckInData,ownerReadEtag,ownerStaffIds} from '@/lib/owner-pos-read-model';
import {getRequestBusinessContext} from '@/lib/request-business-context';
import {isSalonManageContext} from '@/lib/current-context';
import type {SalonManagePageContext} from '@/lib/route-context-guards';
export async function GET(request:Request){
 const responseHeaders={'Cache-Control':'private, no-store',Vary:'Cookie'};
 if((await headers()).get('x-reylumi-auth-unavailable')==='1')return new NextResponse(null,{status:503,headers:responseHeaders});
 try{
  const context=await getRequestBusinessContext();
  if(!context.user)return new NextResponse(null,{status:401,headers:responseHeaders});
  if(!isSalonManageContext(context)||!context.currentSalon||!context.currentAccount||!context.currentBusiness)return new NextResponse(null,{status:403,headers:responseHeaders});
  const ids=ownerStaffIds(new URL(request.url).searchParams.get('ids'));
  const data=await loadOwnerCheckInData({context:context as SalonManagePageContext,ids}),etag=ownerReadEtag({data,ids});
  const conditional={...responseHeaders,ETag:etag};
  if(request.headers.get('if-none-match')===etag)return new NextResponse(null,{status:304,headers:conditional});
  return NextResponse.json({...data,...(ids?{ids,removedIds:ids.filter(id=>!data.staff.some(member=>member.id===id))}:{})},{headers:conditional});
 }catch(error){return new NextResponse(null,{status:(error as {status?:number}).status===400?400:503,headers:responseHeaders});}
}
