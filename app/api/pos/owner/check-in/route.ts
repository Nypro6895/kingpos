import {NextResponse} from 'next/server';
import {getOwnerCheckInData} from '@/app/pos/owner-check-in-actions';
export async function GET(){return NextResponse.json(await getOwnerCheckInData(),{headers:{'Cache-Control':'no-store'}});}
