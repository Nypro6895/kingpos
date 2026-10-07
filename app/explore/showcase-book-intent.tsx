"use client";

import { ExploreBookButton } from "@/components/explore-account-actions";

type ShowcaseBookIntentProps = {
  availability: string;
  bookingHref: string;
  className?: string;
  duration: string;
  price: string;
  salonName: string;
  service: string;
};

export function ShowcaseBookIntent({
  bookingHref,
  className = "",
  price,
  salonName,
}: ShowcaseBookIntentProps) {

  return <ExploreBookButton href={bookingHref} name={`${salonName} · ${price}`} className={className} />;
}
