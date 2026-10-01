export type StaffGreetingHistory = {
  date: string;
  worked_yesterday: boolean;
  yesterday_services: number;
  history_available: boolean;
};

export function staffGreeting(input: {
  name: string;
  timezone: string;
  todayServices: number;
  businessDate: string;
  history?: StaffGreetingHistory | null;
  now: string;
}) {
  const instant = new Date(input.now);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = Number(part("hour"));
  const name = input.name.trim().split(/\s+/)[0] || "there";
  const period = hour < 12 ? "Morning" : hour < 14 ? "Hello" : hour < 18 ? "Afternoon" : "Evening";
  const standard = `${period === "Hello" ? "Hello" : `Good ${period.toLowerCase()}`}, ${name}`;
  let encouragement = "";
  const sameDay = date === input.businessDate;
  if (sameDay && hour >= 14) {
    if (input.todayServices > 500) encouragement = "celebrate tonight!";
    else if (input.todayServices >= 400) encouragement = "amazing work!";
    else if (input.todayServices > 300) encouragement = "great work!";
  } else if (sameDay && hour < 12 && input.history?.date === date && input.history.history_available) {
    if (!input.history.worked_yesterday) encouragement = "rested? Let’s shine!";
    else if (input.history.yesterday_services < 200) encouragement = "today’s your day!";
  }
  return {
    text: encouragement ? `${period}, ${name} — ${encouragement}` : standard,
    compact: encouragement ? `${name} — ${encouragement}` : `${period}, ${name}`,
  };
}
