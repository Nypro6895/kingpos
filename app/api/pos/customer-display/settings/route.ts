import {NextResponse} from 'next/server';
import {getPublicPosDisplaySettingsByToken} from '@/lib/pos-settings';
export async function GET(request:Request){
 const token=new URL(request.url).searchParams.get('token')??'';
 if(!/^[a-f0-9]{32}$/i.test(token))return new NextResponse(null,{status:400});
 return NextResponse.json(await getPublicPosDisplaySettingsByToken(token),{headers:{'Cache-Control':'no-store'}});
}
