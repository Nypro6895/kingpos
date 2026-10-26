import "server-only";
import {sendSystemSms,systemSmsReady} from "@/lib/system-sms";

type LoginSmsAlertInput = {
  deviceLabel: string;
  locationLabel: string;
  phone: string;
};

export type LoginSmsAlertResult =
  | {
      messageId: string | null;
      ok: true;
      provider: "twilio";
    }
  | {
      code: "not_configured" | "send_failed";
      message: string;
      ok: false;
    };

function loginAlertMessage(input: LoginSmsAlertInput) {
  return [
    "Reylumi login detected.",
    `Device: ${input.deviceLabel}.`,
    `Location: ${input.locationLabel}.`,
    "If this was not you, open Login Security and use Secure my account.",
  ].join(" ");
}

export async function getLoginSmsAlertStatus() {
  return {configured:await systemSmsReady('loginAlerts'),provider:'twilio' as const};
}
export async function sendLoginSmsAlert(input: LoginSmsAlertInput): Promise<LoginSmsAlertResult> {
  if (!(await systemSmsReady('loginAlerts'))) return {ok:false,code:'not_configured',message:'Text-message login alerts are temporarily unavailable.'};
  try { return {ok:true,provider:'twilio',messageId:await sendSystemSms('loginAlerts',input.phone,loginAlertMessage(input))}; }
  catch { return {ok:false,code:'send_failed',message:'SMS login alert could not be sent.'}; }
}
