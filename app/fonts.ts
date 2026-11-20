import localFont from "next/font/local";

export const geistSans = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
  preload: false,
});

export const geistMono = localFont({
  src: "./fonts/GeistMono.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  preload: false,
});

export const manrope = localFont({
  src: "./fonts/Manrope.woff2",
  variable: "--font-booking-sans",
  weight: "200 800",
  display: "swap",
  preload: false,
});
