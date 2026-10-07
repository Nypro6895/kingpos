"use client";

import type { NoShowHistoryItem } from "@/lib/booking-no-show";

// A native modal keeps focus inside the warning and returns it to the trigger.
export function confirmNoShowHistory(history: NoShowHistoryItem[]): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[85dvh] overflow-y-auto rounded-2xl border border-orange-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/40";
    dialog.setAttribute("aria-labelledby", "no-show-warning-title");
    const title = document.createElement("h2");
    title.id = "no-show-warning-title";
    title.className = "text-lg font-bold";
    title.textContent = "Previous no-shows";
    const description = document.createElement("p");
    description.className = "mt-2 text-sm text-zinc-600";
    description.textContent = `This customer has ${history.length} unexcused no-show${history.length === 1 ? "" : "s"} at this salon. Review before confirming.`;
    const list = document.createElement("ul");
    list.className = "my-4 grid gap-3";
    for (const item of history) {
      const row = document.createElement("li");
      row.className = "rounded-xl border border-zinc-200 p-3 text-sm";
      const date = document.createElement("strong");
      date.textContent = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: item.timezone }).format(new Date(item.startAt));
      const services = document.createElement("p");
      services.className = "mt-1 text-zinc-600";
      services.textContent = item.services.join(", ") || "Appointment";
      row.append(date, services);
      if (item.note) {
        const note = document.createElement("p");
        note.className = "mt-2 whitespace-pre-wrap text-zinc-600";
        note.textContent = item.note;
        row.append(note);
      }
      list.append(row);
    }
    const buttons = document.createElement("div");
    buttons.className = "sticky bottom-0 flex flex-wrap justify-end gap-2 bg-white pt-3";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "min-h-11 rounded-xl border border-zinc-300 px-4 text-sm font-semibold";
    back.textContent = "Go back";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "min-h-11 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white";
    confirm.textContent = "Confirm anyway";
    let finished = false;
    function finish(value: boolean) {
      if (finished) return;
      finished = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    back.onclick = () => finish(false);
    confirm.onclick = () => finish(true);
    dialog.oncancel = (event) => { event.preventDefault(); finish(false); };
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
    buttons.append(back, confirm);
    dialog.append(title, description, list, buttons);
    document.body.append(dialog);
    dialog.showModal();
    back.focus();
  });
}
