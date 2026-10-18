import { NextResponse } from 'next/server';
import { getCurrentBusinessContext,isSalonManageContext } from '@/lib/current-context';
import { getCurrentSalonBookingWorkspace,BOOKING_PERMISSIONS } from '@/lib/bookings';
import { hasPermission } from '@/lib/permissions';
import { headers } from 'next/headers';
import { getExperienceContext } from '@/lib/experience-context';
import { workspaceResourceResponse } from '@/lib/workspace-resource-response';
export async function GET(request:Request){
 if((await headers()).get('x-reylumi-auth-unavailable')==='1')return new NextResponse(null,{status:503,headers:{'Cache-Control':'private, no-store'}});
 const context=await getCurrentBusinessContext();
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await hasPermission(BOOKING_PERMISSIONS.view,context))return new NextResponse(null,{status:401});
 const params=new URL(request.url).searchParams;
 if(params.has('scope')&&params.get('scope')!==getExperienceContext(context).scope)return new NextResponse(null,{status:409,headers:{'Cache-Control':'private, no-store'}});
 const detailOnly=params.get('resource')==='calendar';
 const ids=params.get('ids')?.split(',').filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,100);
 const workspace=await getCurrentSalonBookingWorkspace(Object.fromEntries(params),context,{detailOnly,ids});
 // Do not serialize account/session context. Calendar patches preserve the
 // already-loaded configuration; configuration events request the full DTO.
 const {context: _context,...dto}=workspace;
 void _context;
 const result=detailOnly?{bookings:workspace.bookings,requests:workspace.requests,timeBlocks:workspace.options.timeBlocks}:dto;
 return workspaceResourceResponse(request,{salonId:context.currentSalon.id,workspace:result});
}
