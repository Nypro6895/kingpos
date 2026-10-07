"use client";

import { useEffect, useState } from "react";

export function useBookingClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const frame = requestAnimationFrame(update);
    const timer = setInterval(update, 15000);
    return () => { cancelAnimationFrame(frame); clearInterval(timer); };
  }, []);
  return now;
}
