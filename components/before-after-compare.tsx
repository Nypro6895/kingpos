"use client";

import Image from "next/image";
import { useState } from "react";

type BeforeAfterCompareImage = {
  alt: string;
  id: string;
  url: string;
};

type BeforeAfterCompareProps = {
  after: BeforeAfterCompareImage | null | undefined;
  aspectClassName?: string;
  before: BeforeAfterCompareImage | null | undefined;
  className?: string;
  priority?: boolean;
  roundedClassName?: string;
  sizes: string;
};

function classes(values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function BeforeAfterCompare({
  after,
  aspectClassName = "aspect-[4/5]",
  before,
  className,
  priority = false,
  roundedClassName = "rounded-[1.15rem]",
  sizes,
}: BeforeAfterCompareProps) {
  const [position, setPosition] = useState(50);

  if (!before?.url || !after?.url) {
    return (
      <div
        className={classes([
          "grid grid-cols-2 gap-1 overflow-hidden bg-surface-muted",
          roundedClassName,
          className,
        ])}
      >
        {[
          { image: before, label: "Before" },
          { image: after, label: "After" },
        ].map((item) => (
          <div
            className="relative aspect-[4/5] min-w-0 bg-surface-muted"
            key={item.image?.id ?? item.label}
          >
            {item.image?.url ? (
              <Image
                alt={item.image.alt}
                className="object-cover"
                fill
                loading={priority ? undefined : "lazy"}
                priority={priority}
                sizes={sizes}
                src={item.image.url}
              />
            ) : null}
            <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold uppercase text-white backdrop-blur">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={classes([
        "relative overflow-hidden bg-surface-muted shadow-[0_18px_46px_rgba(35,25,22,0.08)] ring-1 ring-divider-subtle/80",
        roundedClassName,
        className,
      ])}
    >
      <div className={classes(["relative max-h-[42rem] w-full", aspectClassName])}>
        <Image
          alt={after.alt}
          className="absolute inset-0 object-cover"
          fill
          loading={priority ? undefined : "lazy"}
          priority={priority}
          sizes={sizes}
          src={after.url}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <Image
            alt={before.alt}
            className="object-cover"
            fill
            loading={priority ? undefined : "lazy"}
            priority={priority}
            sizes={sizes}
            src={before.url}
          />
        </div>
        <div
          aria-hidden
          className="absolute bottom-0 top-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(23,19,22,0.18)]"
          style={{ left: `${position}%` }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-text-primary shadow-md ring-1 ring-divider-subtle/80"
          style={{ left: `${position}%` }}
        >
          <span className="h-4 w-0.5 rounded-full bg-text-primary/45" />
        </span>
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold uppercase text-white backdrop-blur">
          Before
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold uppercase text-white backdrop-blur">
          After
        </span>
        <label className="absolute inset-x-4 bottom-4 grid gap-1 rounded-full bg-white/88 px-4 py-2 shadow-sm ring-1 ring-divider-subtle/80 backdrop-blur">
          <span className="sr-only">Compare before and after images</span>
          <input
            aria-label="Compare before and after images"
            className="h-5 w-full cursor-ew-resize"
            max={88}
            min={12}
            onChange={(event) => setPosition(Number(event.currentTarget.value))}
            style={{ accentColor: "var(--brand-orange)" }}
            type="range"
            value={position}
          />
        </label>
      </div>
    </div>
  );
}
