"use client";

import { supabase } from "@/lib/supabase";

export default function NewTicketPage() {
  async function createTicket() {
    const { error } = await supabase.from("tickets").insert({
      status: "open",
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
    });

    if (error) {
      alert("Error creating ticket");
      console.log(error);
      return;
    }

    alert("Ticket created!");
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>New Ticket</h1>

      <button onClick={createTicket}>
        Create Ticket
      </button>
    </main>
  );
}