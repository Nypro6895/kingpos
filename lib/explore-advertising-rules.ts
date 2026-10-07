import type { Campaign } from "@/types/explore-advertising";
export class CampaignValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super("Please correct the highlighted fields.");
  }
}

export function campaignStatus(campaign: Campaign) {
  return campaign.enabled
    ? "running"
    : campaign.status === "stopped"
      ? "stopped"
      : "draft";
}

export function safeCampaignUrl(value: string, image = false) {
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//") && !/[\\\s]/.test(value))
    return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {}
  throw new Error(
    image
      ? "Use an HTTPS image URL or a local image path."
      : "Use an HTTPS link or a local path.",
  );
}
export function campaignActive(campaign: Campaign, now = Date.now()) {
  return (
    campaign.enabled &&
    (!campaign.startsAt || Date.parse(campaign.startsAt) <= now) &&
    (!campaign.endsAt || Date.parse(campaign.endsAt) > now)
  );
}
export function chooseCampaign<T extends { id: string }>(
  items: T[],
  previous?: string | null,
  random = Math.random,
): T | null {
  const pool =
    items.length > 1 ? items.filter((item) => item.id !== previous) : items;
  return pool.length
    ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
    : null;
}
export function parseCampaign(form: FormData): Campaign {
  const errors: Record<string, string> = {};
  const field = (key: string) => String(form.get(key) ?? "").trim();
  const number = (key: string, min: number, max: number) => {
    const value = Number(field(key));
    if (!Number.isFinite(value) || value < min || value > max)
      errors[key] = `Enter a number between ${min} and ${max}.`;
    return value;
  };
  const date = (key: string) => {
    const raw = field(key);
    const value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)
      ? `${raw}Z`
      : raw;
    if (!value) return null;
    if (!Number.isFinite(Date.parse(value))) {
      errors[key] = "Choose a valid date and time.";
      return null;
    }
    return new Date(value).toISOString();
  };
  const kind = field("kind"),
    repeat = field("repeat"),
    position = field("position");
  for (const [key, value, options] of [
    ["kind", kind, ["popup", "placement", "ticker"]],
    ["repeat", repeat, ["always", "once", "daily"]],
    ["position", position, ["top", "bottom"]],
  ] as const) {
    if (!(options as readonly string[]).includes(value))
      errors[key] = "Choose a valid option.";
  }
  const url = (key: string, image = false) => {
    try {
      return safeCampaignUrl(field(key), image);
    } catch (error) {
      errors[key] = (error as Error).message;
      return "";
    }
  };
  const status = field("status") || (form.has("enabled") ? "running" : "draft");
  if (!["draft", "running", "stopped"].includes(status))
    errors.status = "Choose a valid status.";
  const campaign: Campaign = {
    id: field("id") || crypto.randomUUID(),
    name: field("name").slice(0, 120),
    kind: kind as Campaign["kind"],
    enabled: status === "running",
    status: status as Campaign["status"],
    imageUrl: url("imageUrl", true),
    href: url("href"),
    text: field("text").slice(0, 1000),
    background: field("background"),
    color: field("color"),
    delaySeconds: number("delaySeconds", 0, 3600),
    durationSeconds: number("durationSeconds", 0, 3600),
    closeButton: form.has("closeButton"),
    repeat: repeat as Campaign["repeat"],
    position: position as Campaign["position"],
    speedSeconds: number("speedSeconds", 5, 300),
    startsAt: date("startsAt"),
    endsAt: date("endsAt"),
  };
  if (!/^[0-9a-f-]{36}$/i.test(campaign.id))
    errors.id = "Invalid campaign identifier. Reopen the editor.";
  if (!campaign.name) errors.name = "Enter a campaign name.";
  for (const key of ["background", "color"] as const)
    if (!/^#[0-9a-f]{6}$/i.test(campaign[key]))
      errors[key] = "Choose a valid color.";
  if (
    campaign.startsAt &&
    campaign.endsAt &&
    campaign.startsAt >= campaign.endsAt
  )
    errors.endsAt = "End must be after start.";
  if (
    kind === "popup" &&
    !campaign.closeButton &&
    campaign.durationSeconds === 0
  )
    errors.durationSeconds =
      "A popup needs a close button or an automatic close duration.";
  if (Object.keys(errors).length) throw new CampaignValidationError(errors);
  return campaign;
}
