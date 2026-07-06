export type PosTicketReceiptHeader = {
  salon_name: string;
  salon_phone: string | null;
  ticket_number: string;
  customer_name: string;
  created_time: string;
  closed_time: string | null;
  ticket_status: string;
  receipt_status: "Draft" | "Final Receipt" | "Cancelled" | "Voided";
};

export type PosTicketReceiptItem = {
  service_name: string;
  assigned_staff: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type PosTicketReceiptTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  grand_total: number;
  paid: number;
  remaining: number;
};

export type PosTicketReceiptPayment = {
  method: string;
  amount: number;
  created_time: string;
};

export type PosTicketReceipt = {
  header: PosTicketReceiptHeader;
  items: PosTicketReceiptItem[];
  totals: PosTicketReceiptTotals;
  payments: PosTicketReceiptPayment[];
  footer: {
    message: string;
  };
};
