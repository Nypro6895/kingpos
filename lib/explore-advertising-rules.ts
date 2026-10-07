import type { Campaign } from "@/types/explore-advertising";

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
  const field = (key: string) => String(form.get(key) ?? "").trim();
  const number = (key: string, min: number, max: number) => {
    const value = Number(field(key));
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`Invalid ${key}.`);
    return value;
  };
  const date = (key: string) => {
    const value = field(key);
    if (!value) return null;
    if (!Number.isFinite(Date.parse(value)))
      throw new Error("Invalid schedule.");
    return new Date(value).toISOString();
  };
  const kind = field("kind"),
    repeat = field("repeat"),
    position = field("position");
  if (
    !["popup", "placement", "ticker"].includes(kind) ||
    !["always", "once", "daily"].includes(repeat) ||
    !["top", "bottom"].includes(position)
  )
    throw new Error("Invalid campaign settings.");
  const campaign: Campaign = {
    id: field("id") || crypto.randomUUID(),
    name: field("name").slice(0, 120),
    kind: kind as Campaign["kind"],
    enabled: form.has("enabled"),
    imageUrl: safeCampaignUrl(field("imageUrl"), true),
    href: safeCampaignUrl(field("href")),
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
  if (
    !/^[0-9a-f-]{36}$/i.test(campaign.id) ||
    !campaign.name ||
    !campaign.href ||
    (kind === "ticker" ? !campaign.text : !campaign.imageUrl)
  )
    throw new Error("Add a name, link, and image or announcement text.");
  if (
    ![campaign.background, campaign.color].every((color) =>
      /^#[0-9a-f]{6}$/i.test(color),
    )
  )
    throw new Error("Use valid colors.");
  if (
    campaign.startsAt &&
    campaign.endsAt &&
    campaign.startsAt >= campaign.endsAt
  )
    throw new Error("End must be after start.");
  if (
    kind === "popup" &&
    !campaign.closeButton &&
    campaign.durationSeconds === 0
  )
    throw new Error(
      "A popup needs a close button or an automatic close duration.",
    );
  return campaign;
}
