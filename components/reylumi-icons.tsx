import type { SVGProps } from "react";

export type ReylumiIconName =
  | "bell"
  | "bookmark"
  | "calendar"
  | "check"
  | "chevron-left"
  | "close"
  | "dollar"
  | "filter"
  | "flame"
  | "grid"
  | "heart"
  | "home"
  | "image"
  | "map-pin"
  | "message"
  | "more"
  | "search"
  | "share"
  | "sparkle"
  | "star"
  | "user"
  | "verified";

type ReylumiIconProps = SVGProps<SVGSVGElement> & {
  name: ReylumiIconName;
};

export function ReylumiIcon({
  className = "h-4 w-4",
  name,
  strokeWidth = 2,
  ...props
}: ReylumiIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      {...props}
    >
      {iconPath(name)}
    </svg>
  );
}

function iconPath(name: ReylumiIconName) {
  switch (name) {
    case "bell":
      return (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </>
      );
    case "bookmark":
      return <path d="M6 4h12v17l-6-3.5L6 21z" />;
    case "calendar":
      return (
        <>
          <path d="M7 3v3M17 3v3" />
          <path d="M4 8h16" />
          <rect height="17" rx="2" width="16" x="4" y="5" />
        </>
      );
    case "check":
      return <path d="m5 13 4 4L19 7" />;
    case "chevron-left":
      return <path d="m15 18-6-6 6-6" />;
    case "close":
      return <path d="M18 6 6 18M6 6l12 12" />;
    case "dollar":
      return <path d="M12 2v20M17 6.5c-1.3-1-3.1-1.5-5-1.1-2 .4-3 1.5-3 3s1.1 2.3 3.5 2.8c2.6.5 4 1.4 4 3.3 0 1.7-1.6 3-4.2 3-1.9 0-3.7-.6-5.1-1.7" />;
    case "filter":
      return <path d="M4 6h16M7 12h10M10 18h4" />;
    case "flame":
      return <path d="M12 22c4 0 7-2.8 7-6.7 0-2.4-1.4-4.6-3.1-6.3-.6 2.4-2 3.4-3.2 4.1.5-3.3-.7-6.2-3.4-9.1-.1 4-2.7 6.3-3.7 8.8C4.3 14.1 4 15 4 16c0 3.5 3.4 6 8 6Z" />;
    case "grid":
      return (
        <>
          <rect height="5" rx="1" width="5" x="4" y="4" />
          <rect height="5" rx="1" width="5" x="15" y="4" />
          <rect height="5" rx="1" width="5" x="4" y="15" />
          <rect height="5" rx="1" width="5" x="15" y="15" />
        </>
      );
    case "heart":
      return <path d="M20.8 5.6a5.4 5.4 0 0 0-7.6 0L12 6.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 22l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />;
    case "home":
      return (
        <>
          <path d="m3 10 9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </>
      );
    case "image":
      return (
        <>
          <rect height="16" rx="2" width="18" x="3" y="4" />
          <path d="m8 14 2.5-3 3 4 2-2.5L20 18" />
          <circle cx="8" cy="8" r="1" />
        </>
      );
    case "map-pin":
      return (
        <>
          <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      );
    case "message":
      return <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />;
    case "more":
      return (
        <>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </>
      );
    case "share":
      return (
        <>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
        </>
      );
    case "sparkle":
      return (
        <>
          <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
        </>
      );
    case "star":
      return <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2l-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />;
    case "user":
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </>
      );
    case "verified":
      return (
        <>
          <path d="m12 2 2 2.2 3-.3.7 2.9 2.6 1.5-1.2 2.8 1.2 2.8-2.6 1.5-.7 2.9-3-.3-2 2.2-2-2.2-3 .3-.7-2.9-2.6-1.5 1.2-2.8-1.2-2.8 2.6-1.5.7-2.9 3 .3z" />
          <path d="m8.8 12.1 2 2 4.4-4.6" />
        </>
      );
  }
}
