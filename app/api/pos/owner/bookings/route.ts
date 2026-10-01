import { NextResponse } from 'next/server';
import { getCurrentBusinessContext,isSalonManageContext } from '@/lib/current-context';
import { getCurrentSalonBookingWorkspace,BOOKING_PERMISSIONS } from '@/lib/bookings';
import { hasPermission } from '@/lib/permissions';
export async function GET(request:Request){
 const context=await getCurrentBusinessContext();
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await hasPermission(BOOKING_PERMISSIONS.view,context))return new NextResponse(null,{status:401});
 const workspace=await getCurrentSalonBookingWorkspace(Object.fromEntries(new URL(request.url).searchParams),context);
 return NextResponse.json({salonId:context.currentSalon.id,workspace},{headers:{'Cache-Control':'no-store'}});
}
