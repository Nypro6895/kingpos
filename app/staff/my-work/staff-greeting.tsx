"use client";

import { useEffect, useRef, useState } from "react";
import { staffGreeting, type StaffGreetingHistory } from "@/lib/staff-greeting";

export function StaffGreeting(props: {
  name: string; timezone: string; todayServices: number; businessDate: string;
  history: StaffGreetingHistory | null; now: string;
}) {
  const [now, setNow] = useState(props.now);
  const span = useRef<HTMLSpanElement>(null);
  const message = staffGreeting({ ...props, now });
  useEffect(() => {
    const refresh = () => setNow(new Date().toISOString());
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    const node = span.current;
    if (!node) return;
    const fit = () => {
      node.textContent = message.text;
      node.style.fontSize = "26px";
      const width = node.clientWidth;
      if (!width) return;
      let size = Math.min(26, 26 * width / Math.max(node.scrollWidth, 1));
      if (size < 14) {
        node.textContent = message.compact;
        size = Math.min(26, 26 * width / Math.max(node.scrollWidth, 1));
      }
      node.style.fontSize = `${Math.max(14, Math.floor(size))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [message.text, message.compact]);
  return <span ref={span} title={message.text} aria-label={message.text} style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "clamp(14px, 3.4vw, 26px)" }}>{message.text}</span>;
}
