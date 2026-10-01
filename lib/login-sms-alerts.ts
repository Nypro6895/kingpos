import "server-only";

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

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function twilioConfig() {
  const accountSid = readEnv(
    "REYLUMI_TWILIO_ACCOUNT_SID",
    "TWILIO_ACCOUNT_SID",
    "SUPABASE_AUTH_SMS_TWILIO_ACCOUNT_SID",
  );
  const authToken = readEnv(
    "REYLUMI_TWILIO_AUTH_TOKEN",
    "TWILIO_AUTH_TOKEN",
    "SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN",
  );
  const messagingServiceSid = readEnv(
    "REYLUMI_TWILIO_MESSAGING_SERVICE_SID",
    "TWILIO_MESSAGING_SERVICE_SID",
    "SUPABASE_AUTH_SMS_TWILIO_MESSAGE_SERVICE_SID",
  );
  const from = readEnv("REYLUMI_TWILIO_FROM", "TWILIO_FROM");

  if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
    return null;
  }

  return {
    accountSid,
    authToken,
    from,
    messagingServiceSid,
  };
}

function loginAlertMessage(input: LoginSmsAlertInput) {
  return [
    "Reylumi login detected.",
    `Device: ${input.deviceLabel}.`,
    `Location: ${input.locationLabel}.`,
    "If this was not you, open Login Security and use Secure my account.",
  ].join(" ");
}

export function getLoginSmsAlertStatus() {
  return {
    configured: Boolean(twilioConfig()),
    provider: "twilio" as const,
  };
}

export async function sendLoginSmsAlert(
  input: LoginSmsAlertInput,
): Promise<LoginSmsAlertResult> {
  const config = twilioConfig();

  if (!config) {
    return {
      code: "not_configured",
      message: "Text-message login alerts are temporarily unavailable.",
      ok: false,
    };
  }

  const body = new URLSearchParams({
    Body: loginAlertMessage(input),
    To: input.phone,
  });

  if (config.messagingServiceSid) {
    body.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (config.from) {
    body.set("From", config.from);
  }

  const credentials = Buffer.from(
    `${config.accountSid}:${config.authToken}`,
  ).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      config.accountSid,
    )}/Messages.json`,
    {
      body,
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");

    console.error("Twilio login SMS alert failed", {
      body: errorText.slice(0, 500),
      status: response.status,
      statusText: response.statusText,
    });

    return {
      code: "send_failed",
      message: "SMS login alert could not be sent.",
      ok: false,
    };
  }

  const payload = await response.json().catch(() => null) as
    | {
        sid?: string;
      }
    | null;

  return {
    messageId: payload?.sid ?? null,
    ok: true,
    provider: "twilio",
  };
}
