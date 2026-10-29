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
  available?: boolean;
  trial?: string;
  workflow?: string[];
  plans?: { name: string; price: string; detail: string }[];
};

// Concept listings remain previews; the Reylumi payroll download plugin is installable.
export const sampleApps: MarketApp[] = [
  {id:'booksms',name:'BookSMS',category:'Customer care',symbol:'SMS',color:'mint',publisher:'Reylumi',available:true,price:'Price pending',trial:'Price and SMS allowance will be announced before purchases open',summary:'Booking confirmations and appointment reminders by SMS.',description:'Activate BookSMS for your salon to send booking confirmations, changes, cancellations and reminders. Manage its Twilio sender and delivery preferences in this plugin.',features:['SMS booking confirmations and updates','Appointment reminders','Separate salon SMS provider settings','Paid access and SMS allowance checks'],permissions:['Read appointment details and customer phone numbers','Send booking SMS for the active salon'],workflow:['Activate paid access in Market','Configure your SMS sender in BookSMS','Choose confirmations and reminders']},
  { id: "booking-deposit", name: "Booking Deposit", category: "Payments", symbol: "BD", color: "mint", publisher: "Reylumi", available: true, price: "$5.90 / month", trial: "Monthly subscription · Per salon", summary: "Collect a deposit or full payment before an appointment is confirmed.", description: "Choose fixed deposits, percentage deposits or full service prepayment. Customers pay securely in booking or on Stripe, with receipts saved to their appointment.", features: ["On/off payment requirement", "Fixed, percentage or full service payment", "Card entry and Stripe checkout", "Paid amounts and Stripe receipts"], permissions: ["Salon owners configure payment rules", "Stripe processes cards and pays your salon", "Payment receipts attach to customer bookings"], workflow: ["Subscribe and connect your salon's Stripe account", "Choose your deposit and checkout preferences", "Customers pay before their booking is submitted"], plans: [{ name: "Booking Deposit", price: "$5.90 / month", detail: "USD · Per salon · Stripe processing, refund and dispute fees are paid by the salon." }] },
  { id: "print-check", name: "Check Writer", category: "Payroll", symbol: "PC", color: "peach", summary: "From approved payroll to a clean, printable check.", description: "Prepare check layouts from a completed payroll period and review everything before printing.", features: ["Payroll and standalone checks", "Optional details on two stubs", "Check history, void and controlled reprints"], permissions: ["Read payroll totals and payee names", "Read salon business details"], price: "Free sample" },
  { id: "inventory-sync", name: "Inventory Sync", category: "Operations", symbol: "IS", color: "mint", summary: "Keep salon supplies and retail stock in one view.", description: "Explore a connected inventory workflow for supplies, retail products and low-stock reminders.", features: ["Stock overview", "Low-stock reminders", "Product matching"], permissions: ["Read product catalog", "Read and update inventory"], price: "Paid plan sample" },
  { id: "return-visit", name: "Return Visit", category: "Marketing", symbol: "RV", color: "rose", summary: "Make the next appointment part of every great visit.", description: "Preview a rebooking assistant that helps your team follow up with customers who choose to receive messages.", features: ["Rebooking suggestions", "Message preview", "Customer preference controls"], permissions: ["Read completed appointments", "Read customer contact preferences"], price: "Free sample" },
  { id: "salon-insights", name: "Salon Insights", category: "Reporting", symbol: "SI", color: "lavender", summary: "Turn everyday activity into a clearer business picture.", description: "Explore simple reports that bring sales and booking trends together for your salon.", features: ["Sales trends", "Booking overview", "Export preview"], permissions: ["Read sales summaries", "Read booking summaries"], price: "Paid plan sample" },
  { id: "team-calendar", name: "Team Calendar", category: "Operations", symbol: "TC", color: "blue", summary: "A shared view of schedules, shifts and appointments.", description: "Preview a calendar connection that keeps your team aligned throughout the working day.", features: ["Team schedule view", "Appointment sync preview", "Shift overview"], permissions: ["Read staff schedules", "Read appointments"], price: "Free sample" },
  { id: "review-studio", name: "Review Studio", category: "Marketing", symbol: "RS", color: "sand", summary: "Give customer feedback a thoughtful follow-up.", description: "Explore a workspace for reviewing customer feedback and preparing personalized responses.", features: ["Feedback overview", "Response drafts", "Follow-up reminders"], permissions: ["Read salon reviews", "Read public salon profile"], price: "Paid plan sample" },
];

const concepts: Record<string, Pick<MarketApp, "publisher" | "trial" | "workflow" | "plans"> & { price: string; description: string }> = {
  "print-check": {
    publisher: "Reylumi", price: "$4.90 / month", trial: "Monthly subscription · Per salon",
    description: "Create checks from current or saved payroll, or enter a standalone check. Review a Letter-size check and two optional payroll stubs before printing. Sign by hand after printing.",
    workflow: ["Activate Check Writer for your salon", "Configure bank and check stock", "Review, create and print checks"],
    plans: [{name:"Check Writer",price:"$4.90 / month",detail:"USD · Per salon · Payroll and standalone checks, two optional stubs and check history."}],
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

sampleApps.push({
 id: "vietnamese-language", name: "Tiếng Việt", category: "Operations", symbol: "VI", color: "rose", publisher: "reylumi", price: "$3.99 / tháng", trial: "Dùng thử miễn phí 5 ngày",
 summary: "Giao diện tiếng Việt cho chủ tiệm, tùy chọn thêm nhân viên và Portable.",
 description: "Sử dụng tiếng Việt trong không gian chủ tiệm. Có thể thêm cho nhân viên ở các phần lịch hẹn, lịch làm việc, lương và yêu cầu với chủ tiệm, cùng tùy chọn cho Portable POS. Nhân viên và Portable đã bao gồm trong giá $3.99 mỗi tháng. Tên khách hàng, tên dịch vụ và ghi chú được giữ nguyên.",
 features: ["Điều hướng và các nhãn giao diện chủ tiệm bằng tiếng Việt", "Tùy chọn tiếng Việt cho phần liên quan giữa chủ tiệm và nhân viên", "Tùy chọn tiếng Việt cho Portable POS", "Dùng thử 5 ngày một lần cho mỗi tiệm; sau đó $3.99 USD/tháng"],
 permissions: ["Chủ tiệm quản lý cài đặt và các tùy chọn ngôn ngữ", "Nhân viên chỉ dùng trong tiệm đang kết nối", "Giữ nguyên dữ liệu kinh doanh và quyền của nhân viên"],
 workflow: ["Bắt đầu dùng thử miễn phí 5 ngày", "Chọn thêm nhân viên và Portable nếu cần", "Sử dụng không gian làm việc bằng tiếng Việt", "Đăng ký sau thời gian dùng thử để tiếp tục"],
 plans: [{ name: "Tiếng Việt", price: "$3.99 / tháng", detail: "Mỗi tiệm · Chủ tiệm, tùy chọn nhân viên và Portable · Dùng thử 5 ngày, không cần thẻ." }],
});


sampleApps.unshift({
 id: "payroll-data-download", name: "Payroll Data Download", category: "Payroll", symbol: "PD", color: "mint", publisher: "Reylumi", price: "Free", trial: "Free forever · No subscription",
 summary: "Download salon financial, staff and customer data from Payroll.",
 description: "Adds Download at the bottom of Owner → Payroll for your current salon, across devices. Choose up to one year and prepare separate CSV files for Excel or other spreadsheet apps. Removing the plugin hides Download; your salon records stay intact.",
 workflow: ["Add this free plugin to Reylumi", "Open Owner → Payroll and scroll to Download at the bottom", "Choose From and To dates, then select your data categories", "Prepare downloads and download each selected CSV"],
 features: ["Salon financial: daily POS and actual income, cash/card/other payments, over or short amounts, staff net pay, tax withheld and shop net income", "Staff income: sales, earnings, tips, bonuses, taxes, cash/check payouts and final income for your date range", "Customers: names, phone numbers, emails and status of profiles created within the selected dates (UTC)", "Select one, two or all three categories; separate CSV files", "Without plugin: regular Payroll. With plugin: Download appears at the bottom", "Owner access only; no external provider or automatic sharing"],
 permissions: ["Read the current salon’s payroll and financial data", "Read customer contact details for export", "Only owners can add, remove and use this plugin"],
 plans: [{ name: "Free", price: "$0", detail: "All categories, custom dates and CSV downloads. No paid upgrade." }]
});


sampleApps.push({id:"campaigns",name:"Campaigns",category:"Marketing",symbol:"CA",color:"mint",publisher:"Reylumi",price:"Free to add",trial:"One-time welcome credits · No subscription",summary:"Your photos. Your message. More people discovering your business.",description:"Create an ad with your own photo and message, or promote a published post. Choose an area, a view limit and how long to run. Use credits to reach more people, see real results and stop anytime.",features:["Create ads with your own photos and content","Promote an existing post in a few clicks","One-time welcome credits to try your first local ad","Clear credit estimates by area, views and duration","Optional automatic top-ups with a monthly limit"],permissions:["Only owners can add and use Campaigns","Read the selected salon posts and upload ad images","Use your ad credits for approved campaigns"],workflow:["Add Campaigns for free","Use your welcome credits for a first local ad","Choose a photo or a published post and an audience","Watch results and buy more credits when you need them"],plans:[{name:"Add Campaigns",price:"$0",detail:"No subscription. Welcome credits are offered once; removing and adding again does not reset the offer."},{name:"Ad credits",price:"Flexible credit packs",detail:"Spend only on delivered views. Automatic purchases require your permission."}]});


sampleApps.push({ id: "checkin-receipt", name: "Check-in Receipt", category: "Operations", symbol: "CR", color: "mint", publisher: "Reylumi", price: "$4.70 / month", trial: "$4.70 per salon / month",
 summary: "Check in, print a queue number, then scan to start a ticket.",
 description: "After a customer enters their information and taps Done, Reylumi prepares a receipt with a daily queue number and QR code. Scan the receipt at the front desk to bring that customer's check-in into your POS ticket. Windows customer displays print automatically to the default receipt printer; browser devices open a print dialog.",
 features: ["Automatic receipt printing on Windows", "Daily queue numbers", "QR scan to start a ticket", "Reprint without changing the queue number"],
 permissions: ["Read customer check-ins and names", "Issue queue numbers and print receipts", "Select checked-in customers for POS tickets"],
 workflow: ["Customer enters information and taps Done", "Printer issues a numbered receipt with QR code", "Staff scans the receipt in POS → Waiting to start the customer's ticket"],
 plans: [{ name: "Receipt", price: "$4.70 / month", detail: "Per salon · Requires a receipt printer. Automatic printing uses the Windows default printer and Reylumi desktop customer display." }]
});

// Only these listings currently have installation and usage flows.
sampleApps.push({ id: "service-relay", name: "Phone Checkin", category: "Operations", symbol: "PC", color: "mint", publisher: "Reylumi", price: "$9.99 / month", trial: "Per salon · Monthly",
 summary: "POS assigns customers. Staff send services and prices straight to the cashier.",
 description: "Customers check in at the salon screen or scan to check in on their phone. POS sends the next customer to an eligible staff member using its queue order. Staff accept or decline, enter services and prices, and tap Done. Multiple staff share the customer's ticket. Cashiers review and Submit through the existing POS workflow.",
 features: ["Automatic staff offers with Accept and Decline", "One customer ticket across multiple staff", "Simple service and price entry", "Digital check-in pass and manual number or QR fallback", "Live cashier status and ready-to-pay tickets", "Existing POS turn, commission and income settings"],
 permissions: ["Owners install for their salon", "Staff manage only their own assigned work", "Cashiers review service tickets and confirm payment"],
 workflow: ["Add Phone Checkin and enable staff services in POS", "Customer checks in and chooses services", "POS assigns staff; staff accept, enter prices and tap Done", "Cashier reviews the shared ticket and confirms payment with Submit"],
 plans: [{ name: "Phone Checkin", price: "$9.99 / month", detail: "USD · Per salon · Uses your existing POS settings. No SMS or proximity pairing required." }]
});
for (const app of sampleApps) app.available = ["service-relay", "payroll-data-download", "campaigns", "vietnamese-language", "checkin-receipt"].includes(app.id);

sampleApps.push({ id: "booking-policy", name: "Booking Rules", category: "Customer care", symbol: "BR", color: "blue", publisher: "reylumi", available: true, price: "$0.99 / month", trial: "Monthly subscription · Per salon", summary: "Publish your salon's booking rules for customers to review.", description: "Create your own booking rules, start with suggested basics, and display them in your salon's booking flow.", features: ["Editable booking rules", "Suggested starter rules", "Customer preview", "Publish or hide without losing your draft"], permissions: ["Owners manage their salon's booking rules", "Customers can read published rules"], workflow: ["Review and customize suggested rules", "Subscribe for $0.99 per month", "Publish for customers to review before booking"], plans: [{ name: "Booking Rules", price: "$0.99 / month", detail: "USD · Per salon · Custom rules and customer preview." }] });
