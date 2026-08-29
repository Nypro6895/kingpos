import "server-only";

export type EmailDeliveryResult =
  | {
      recipient: string;
      status: "sent";
    }
  | {
      reason: string;
      recipient?: string | null;
      status: "skipped";
    }
  | {
      reason: string;
      recipient: string;
      status: "failed";
    };

type SendEmailInput = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

function getEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.STAFF_INVITE_EMAIL_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    return null;
  }

  return { apiKey, from };
}

export function isEmailProviderConfigured() {
  return Boolean(getEmailConfig());
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<EmailDeliveryResult> {
  const recipient = input.to.trim().toLowerCase();
  const config = getEmailConfig();

  if (!recipient) {
    return {
      reason: "No recipient email was provided.",
      status: "skipped",
    };
  }

  if (!config) {
    return {
      reason:
        "Custom email provider is not connected yet.",
      recipient,
      status: "skipped",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        from: config.from,
        html: input.html,
        subject: input.subject,
        text: input.text,
        to: recipient,
      }),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        reason: body || `Email provider returned ${response.status}.`,
        recipient,
        status: "failed",
      };
    }

    return { recipient, status: "sent" };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : "Email request failed.",
      recipient,
      status: "failed",
    };
  }
}
