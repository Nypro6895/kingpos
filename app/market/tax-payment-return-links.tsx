"use client";
import {marketTargetHref} from "@/lib/market-target-url";

import {useEffect} from "react";
import {taxOwnerReturnPath,taxPaymentReturnPath} from "@/lib/tax-flow";
import {isReylumiIOSClient} from "@/lib/ios-client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { taxActivationHref } from "@/lib/tax-activation";

export function TaxPaymentReturnLinks() {
  const query = useSearchParams();
  const setup =
    query.get("plugin") === "tax-company"
      ? taxActivationHref(query.get("salon") ?? "", true)
      : undefined;
  const origin=taxOwnerReturnPath(query.get("return"),query.get("salon")??"");
  const destination=origin?(query.has("cancelled")?origin:taxPaymentReturnPath(origin,query.get("salon")??"")):setup;
  useEffect(()=>{if(origin&&destination&&!isReylumiIOSClient(navigator.userAgent))window.location.replace(destination);},[origin,destination]);
  return (
    <>
      <a
        href={`reylumi://market${query.get("salon") ? `?salon=${encodeURIComponent(query.get("salon")!)}` : ""}`}
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-zinc-950 px-5 text-white"
      >
        Open Reylumi app
      </a>
      <p className="mt-4">
        <Link href={destination ?? marketTargetHref("/market", setup ? query.get("salon") ?? undefined : undefined)} className="underline">
          {destination
            ? origin ? "Return to your Tax page" : "Continue to Tax connection setup on the website"
            : "Continue on the website"}
        </Link>
      </p>
    </>
  );
}
