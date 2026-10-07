import { NextResponse } from 'next/server';
import { getCurrentBusinessContext,isSalonManageContext } from '@/lib/current-context';
import { getCurrentSalonBookingWorkspace,BOOKING_PERMISSIONS } from '@/lib/bookings';
import { hasPermission } from '@/lib/permissions';
export async function GET(request:Request){
 const context=await getCurrentBusinessContext();
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await hasPermission(BOOKING_PERMISSIONS.view,context))return new NextResponse(null,{status:401});
 const params=new URL(request.url).searchParams;
 const detailOnly=params.get('resource')==='calendar';
 const ids=params.get('ids')?.split(',').filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,100);
 const workspace=await getCurrentSalonBookingWorkspace(Object.fromEntries(params),context,{detailOnly,ids});
 // Do not serialize account/session context. Calendar patches preserve the
 // already-loaded configuration; configuration events request the full DTO.
 const {context: _context,...dto}=workspace;
 void _context;
 const result=detailOnly?{bookings:workspace.bookings,requests:workspace.requests,timeBlocks:workspace.options.timeBlocks}:dto;
 return NextResponse.json({salonId:context.currentSalon.id,workspace:result},{headers:{'Cache-Control':'no-store'}});
}
