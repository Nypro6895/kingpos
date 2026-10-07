"use server";
import {requireSalonManagePageContext} from '@/lib/route-context-guards';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentSalonStaffTodayBoard} from '@/lib/staff-workdays';
import {getCurrentSalonPosDeskData} from '@/lib/pos-desk';
import {getContextBusinessTimezone} from '@/lib/salon-business-clock';
import {broadcastPosStaffChange} from '@/lib/pos-staff-realtime-server';
import {revalidatePath} from 'next/cache';
import type {PortableCheckInData,PortableAttendanceEventInput,PortableAttendanceEventUpdate} from './portable/actions';
export async function getOwnerCheckInData():Promise<PortableCheckInData>{
 const context=await requireSalonManagePageContext('/pos/check-in');
 const [board,desk]=await Promise.all([getCurrentSalonStaffTodayBoard(context),getCurrentSalonPosDeskData({context,includeCustomers:false})]);
 return {salonId:context.currentSalon.id,salonName:context.currentSalon.name,salonLogoUrl:null,timezone:await getContextBusinessTimezone(context),today:board.today,checkInEnabled:desk.defaults.staffCheckInEnabled,
 staff:board.staff.filter(s=>s.pos_enabled).map(s=>({id:s.id,displayName:s.display_name,jobTitle:s.job_title,avatarUrl:null,isPasscodeDefault:Boolean(s.passcode_is_default),status:s.today_status,checkInAt:s.today_workday?.check_in_at??null,checkInSequence:s.today_workday?.check_in_sequence??null,queueTurnCount:s.today_workday?.queue_turn_count??0}))};
}
export async function ownerSubmitAttendance(input:PortableAttendanceEventInput):Promise<{ok:true;data:PortableAttendanceEventUpdate}|{ok:false;error:string}>{
 try{
 const context=await requireSalonManagePageContext('/pos/check-in');
 if(!['CHECK_IN','CHECK_OUT','LEAVE_OUT','RETURN_TO_WORK'].includes(input.eventType)||!/^\d{4}$/.test(input.passcode)||!input.staffId)throw Error('Check the staff member, action and four-digit passcode.');
 const db=await createAuthenticatedSupabaseServerClient();if(!db)throw Error('Please reconnect and try again.');
 const {data,error}=await db.rpc('submit_owner_pos_attendance_event',{p_key_id:context.currentSalon.id,p_session_signature:'owner',p_staff_id:input.staffId,p_passcode:input.passcode,p_event_type:input.eventType});
 if(error)throw Error(error.code==='PGRST202'?'Owner check-in requires the latest database update.':error.message);
 if(!data)throw Error('The attendance update could not be confirmed.');
 revalidatePath('/pos/check-in');await broadcastPosStaffChange(context.currentSalon.id,'attendance');return {ok:true,data:data as PortableAttendanceEventUpdate};
 }catch(e){return {ok:false,error:e instanceof Error?e.message:'Attendance could not be updated.'};}
}
