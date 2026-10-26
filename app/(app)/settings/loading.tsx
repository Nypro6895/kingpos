import { SettingsLoading } from "@/app/settings/settings-loading";
import "@/app/settings/settings-hub.css";

export default function LoadingSettings() {
  return <div className="settings-hub settings-route-loading"><h1>All Settings</h1><SettingsLoading/></div>;
}
