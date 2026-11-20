import type { SVGProps } from "react";

export const SETTINGS_GEAR_PATH = "M9.130 5.071 L10.313 4.692 L10.264 2.152 L13.736 2.152 L13.687 4.692 L14.870 5.071 L15.974 5.640 L17.736 3.808 L20.192 6.264 L18.360 8.026 L18.929 9.130 L19.308 10.313 L21.848 10.264 L21.848 13.736 L19.308 13.687 L18.929 14.870 L18.360 15.974 L20.192 17.736 L17.736 20.192 L15.974 18.360 L14.870 18.929 L13.687 19.308 L13.736 21.848 L10.264 21.848 L10.313 19.308 L9.130 18.929 L8.026 18.360 L6.264 20.192 L3.808 17.736 L5.640 15.974 L5.071 14.870 L4.692 13.687 L2.152 13.736 L2.152 10.264 L4.692 10.313 L5.071 9.130 L5.640 8.026 L3.808 6.264 L6.264 3.808 L8.026 5.640 Z";

export function SettingsIconShape() {
  return <><path d={SETTINGS_GEAR_PATH} /><circle cx="12" cy="12" r="3" /></>;
}

export function SettingsIcon({ className = "size-5 shrink-0", style, ...props }: SVGProps<SVGSVGElement>) {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} {...props} style={{ ...style, aspectRatio: "1", flexShrink: 0 }}><SettingsIconShape /></svg>;
}
