import {notFound} from 'next/navigation';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import {getTwilioSettings,publicTwilioSettings} from '@/lib/twilio-settings';
import {TwilioSettingsForm} from './settings-form';
export default async function TwilioSettingsPage() {
 const actor=await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.teamManage,{loginNextPath:'/admin/settings/twilio'});
 if(actor.roleSlug!=='platform_owner') notFound();
 const settings=publicTwilioSettings(await getTwilioSettings());
 return <><h1 className="text-2xl font-semibold">Twilio settings</h1><p className="mt-2 text-sm text-zinc-500">Manage claim verification and booking SMS. Only platform owners can access these settings.</p><TwilioSettingsForm settings={settings}/></>;
}
