import { additionalSampleApps } from "./additional-sample-apps";

export type MarketApp = {
  id: string;
  name: string;
  category: "Payroll" | "Operations" | "Marketing" | "Reporting" | "Customer care" | "Payments" | "Commerce";
  symbol: string;
  color: string;
  summary: string;
  description: string;
  features: string[];
  permissions: string[];
  price: string;
  publisher?: string;
  trial?: string;
  workflow?: string[];
  plans?: { name: string; price: string; detail: string }[];
};

// Fictional catalog for UI review. No registration, billing or installation occurs.
export const sampleApps: MarketApp[] = [
  { id: "print-check", name: "Print Check", category: "Payroll", symbol: "PC", color: "peach", summary: "From approved payroll to a clean, printable check.", description: "Prepare check layouts from a completed payroll period and review everything before printing.", features: ["Check layout preview", "Batch printing workflow", "Payroll period summary"], permissions: ["Read payroll totals and payee names", "Read salon business details"], price: "Free sample" },
  { id: "inventory-sync", name: "Inventory Sync", category: "Operations", symbol: "IS", color: "mint", summary: "Keep salon supplies and retail stock in one view.", description: "Explore a connected inventory workflow for supplies, retail products and low-stock reminders.", features: ["Stock overview", "Low-stock reminders", "Product matching"], permissions: ["Read product catalog", "Read and update inventory"], price: "Paid plan sample" },
  { id: "return-visit", name: "Return Visit", category: "Marketing", symbol: "RV", color: "rose", summary: "Make the next appointment part of every great visit.", description: "Preview a rebooking assistant that helps your team follow up with customers who choose to receive messages.", features: ["Rebooking suggestions", "Message preview", "Customer preference controls"], permissions: ["Read completed appointments", "Read customer contact preferences"], price: "Free sample" },
  { id: "salon-insights", name: "Salon Insights", category: "Reporting", symbol: "SI", color: "lavender", summary: "Turn everyday activity into a clearer business picture.", description: "Explore simple reports that bring sales and booking trends together for your salon.", features: ["Sales trends", "Booking overview", "Export preview"], permissions: ["Read sales summaries", "Read booking summaries"], price: "Paid plan sample" },
  { id: "team-calendar", name: "Team Calendar", category: "Operations", symbol: "TC", color: "blue", summary: "A shared view of schedules, shifts and appointments.", description: "Preview a calendar connection that keeps your team aligned throughout the working day.", features: ["Team schedule view", "Appointment sync preview", "Shift overview"], permissions: ["Read staff schedules", "Read appointments"], price: "Free sample" },
  { id: "review-studio", name: "Review Studio", category: "Marketing", symbol: "RS", color: "sand", summary: "Give customer feedback a thoughtful follow-up.", description: "Explore a workspace for reviewing customer feedback and preparing personalized responses.", features: ["Feedback overview", "Response drafts", "Follow-up reminders"], permissions: ["Read salon reviews", "Read public salon profile"], price: "Paid plan sample" },
];

const concepts: Record<string, Pick<MarketApp, "publisher" | "trial" | "workflow" | "plans"> & { price: string; description: string }> = {
  "print-check": {
    publisher: "Paperlane", price: "From $12 / month", trial: "14-day trial",
    description: "Payday should end with confidence. Bring an approved payroll period into a guided check-printing workspace, review payees and amounts, then prepare a batch for compatible check stock. A proposed companion to Reylumi payroll—not a bank payment or tax-filing service.",
    workflow: ["Choose an approved payroll period", "Review payees, amounts and check numbers", "Preview alignment, then print your batch"],
    plans: [{ name: "Starter", price: "$12 / month", detail: "Per salon · Up to 50 checks per month, layout preview and print history." }, { name: "Studio", price: "$24 / month", detail: "Per salon · Up to 250 checks, saved templates and batch exports. Check stock sold separately." }],
  },
  "inventory-sync": {
    publisher: "Stockleaf", price: "From $19 / month", trial: "14-day trial",
    description: "Know what is on the shelf before the busy weekend. Connect retail sales with stock movements, organize professional supplies and create a reorder list your team can review. Designed for the practical rhythm of a salon, from polish shades to backbar essentials.",
    workflow: ["Match your products and opening quantities", "Review sales-linked stock changes", "Approve a low-stock reorder list"],
    plans: [{ name: "Essentials", price: "$19 / month", detail: "Per salon · Up to 500 products, stock alerts and reorder lists." }, { name: "Growth", price: "$39 / month", detail: "Per salon · Up to 2,000 products, supplier records and transfer workflows." }],
  },
  "return-visit": {
    publisher: "Bloomloop", price: "From $15 / month", trial: "14-day trial",
    description: "Keep the relationship growing after the appointment. Plan a thoughtful follow-up around the service a customer received, review the message and invite them to book again. Proposed campaigns respect customer communication preferences and put the salon in control of every send.",
    workflow: ["Choose a service and follow-up window", "Preview the audience and message", "Approve a campaign with a booking link"],
    plans: [{ name: "Email", price: "$15 / month", detail: "Per salon · 1,000 emails per month, audience filters and rebooking templates." }, { name: "Email + SMS", price: "$29 / month", detail: "Per salon · 2,500 emails and SMS workflows. SMS charged separately; proposed US rate $0.03 per segment." }],
  },
  "salon-insights": {
    publisher: "Clearframe", price: "Free · Pro $25 / month", trial: "Free plan + 14-day Pro trial",
    description: "Make the next business decision with a clearer view. Bring booking and sales summaries into one place, compare periods and explore which services keep your salon moving. Reports are designed to explain trends without promising a particular revenue outcome.",
    workflow: ["Connect salon sales and booking summaries", "Choose a reporting period", "Review trends and share your summary"],
    plans: [{ name: "Free", price: "$0", detail: "One salon · Monthly overview and a rolling 30-day comparison." }, { name: "Pro", price: "$25 / month", detail: "Per salon · Longer history, service-level comparisons and CSV exports." }],
  },
  "team-calendar": {
    publisher: "Dayweave", price: "Free · Team $9 / month", trial: "Free plan + 14-day Team trial",
    description: "Give everyone a shared picture of the day. Preview a team calendar that brings working hours and appointments together, with privacy-aware calendar exports so staff can see when they are busy without exposing customer details.",
    workflow: ["Choose the staff schedules to include", "Set which appointment details are visible", "Share a calendar view with your team"],
    plans: [{ name: "Free", price: "$0", detail: "One salon · Up to 3 staff calendars and a shared weekly view." }, { name: "Team", price: "$9 / month", detail: "Per salon · Up to 25 staff calendars, calendar export and shift-change alerts." }],
  },
  "review-studio": {
    publisher: "Kindreply", price: "From $12 / month", trial: "14-day trial",
    description: "A good response starts with listening. Organize Reylumi salon reviews, draft a personal reply and keep track of feedback that needs attention. Your team reviews every response before publishing; external review-site integrations would be a later addition.",
    workflow: ["Bring Reylumi reviews into a shared inbox", "Draft and edit a thoughtful response", "Approve the reply and track follow-up"],
    plans: [{ name: "Solo", price: "$12 / month", detail: "Per salon · Review inbox, response templates and follow-up notes." }, { name: "Team", price: "$22 / month", detail: "Per salon · Shared assignments, approval workflow and monthly feedback summary." }],
  },
};

for (const app of sampleApps) Object.assign(app, concepts[app.id]);
sampleApps.push(...additionalSampleApps);
