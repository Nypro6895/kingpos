"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useRef, useSyncExternalStore, type SelectHTMLAttributes } from "react";
import { TIME_ZONE_OPTIONS } from "@/lib/time-zone-options";

const subscribe = () => () => {};
const getDeviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerZone = () => "";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children">;
export function TimeZoneSelect(props: Props) {
  const __vt = useWorkspaceTranslation();

  const deviceZone = useSyncExternalStore(subscribe, getDeviceZone, getServerZone);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const zone = deviceZone;
    if (zone && !props.value && !props.defaultValue && ref.current) {
      ref.current.value = zone;
      ref.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, [deviceZone, props.value, props.defaultValue]);
  const current = String(props.value ?? props.defaultValue ?? "");
  const extra = [current, deviceZone].filter((zone, index, all) => zone && !TIME_ZONE_OPTIONS.some(value => value === zone) && all.indexOf(zone) === index);
  return <select {...props} ref={ref}>
    {!current && !deviceZone ? <option value=""><WorkspaceText text="Choose time zone" /></option> : null}
    {deviceZone ? <optgroup label={__vt("Device time zone")}><option value={deviceZone}><WorkspaceText text="Use device time zone —" /> {deviceZone.replaceAll("_", " ")}</option></optgroup> : null}
    <optgroup label={__vt("Choose a time zone")}>
      {[...extra, ...TIME_ZONE_OPTIONS].map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ").replaceAll("/", " / ")}</option>)}
    </optgroup>
  </select>;
}
