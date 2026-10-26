export function formatCustomerDateTime(value: string | null, timeZone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone,
  }).format(new Date(value));
}
