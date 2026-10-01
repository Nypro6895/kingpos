import {NextResponse} from 'next/server';
import {getCurrentSalonPosTickets} from '@/lib/pos-tickets';
import {getCurrentBusinessContext,isSalonManageContext} from '@/lib/current-context';
import {hasPermission} from '@/lib/permissions';
export async function GET(request:Request){
 const context=await getCurrentBusinessContext();
 if(!context.user||!context.currentSalon||!isSalonManageContext(context)||!await hasPermission('tickets.view',context))return new NextResponse(null,{status:401});
 const params=new URL(request.url).searchParams,openedFrom=params.get('openedFrom')??'',openedTo=params.get('openedTo')??'';
 if(!Number.isFinite(Date.parse(openedFrom))||!Number.isFinite(Date.parse(openedTo))||Date.parse(openedTo)-Date.parse(openedFrom)>172800000)return new NextResponse(null,{status:400});
 const ids=params.get('ids')?.split(',').filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,100);
 const {tickets}=await getCurrentSalonPosTickets({openedFrom,openedTo,ids});
 return NextResponse.json({salonId:context.currentSalon.id,tickets},{headers:{'Cache-Control':'no-store'}});
}
