import { APP_LOCAL_READ_RESOURCES } from "./app-local-role-resources";
import { APP_LOCAL_PLATFORM_READS } from "./app-local-platform-types";
import { APP_LOCAL_PERSONAL_READS } from "./app-local-personal-metadata";
import { APP_LOCAL_BUSINESS_READS } from "./app-local-business-metadata";
import { APP_LOCAL_EXPLORE_READS } from "./app-local-explore-metadata";
import { APP_LOCAL_PUBLIC_READS } from "./app-local-public-metadata";
import { APP_LOCAL_DAILY_READS } from "./app-local-daily-metadata";
import { APP_LOCAL_SECONDARY_READS } from "./app-local-secondary-metadata";
import { APP_LOCAL_COMMERCE_READS } from "./app-local-commerce-metadata";
import { APP_LOCAL_SHELL_READS } from "./app-local-shell-metadata";
import { APP_LOCAL_PORTABLE_READS } from "./app-local-portable-metadata";
import { APP_LOCAL_DISPLAY_READS } from "./app-local-display-metadata";
import owner from "./app-local-owner-page-registry.json";
const core = new Set(["owner.workspace","owner.check-in","owner.bookings","owner.tickets","owner.reports","staff.relay"]);
/** Unknown reads and security/control DTOs never become durable by default. */
export function appLocalReadIsDurable(name:string):boolean{
  if(core.has(name))return true;
  if(Object.hasOwn(APP_LOCAL_DISPLAY_READS,name))return APP_LOCAL_DISPLAY_READS[name as keyof typeof APP_LOCAL_DISPLAY_READS].retention==="scoped";
  if(Object.hasOwn(APP_LOCAL_PORTABLE_READS,name))return APP_LOCAL_PORTABLE_READS[name as keyof typeof APP_LOCAL_PORTABLE_READS].retention==="scoped";
  if(Object.hasOwn(APP_LOCAL_READ_RESOURCES,name))return name!=="market.catalog";
  if(Object.hasOwn(APP_LOCAL_PLATFORM_READS,name))return APP_LOCAL_PLATFORM_READS[name as keyof typeof APP_LOCAL_PLATFORM_READS].retention==="scoped";
  if(Object.hasOwn(APP_LOCAL_PERSONAL_READS,name))return APP_LOCAL_PERSONAL_READS[name as keyof typeof APP_LOCAL_PERSONAL_READS].cacheable;
  if(Object.hasOwn(APP_LOCAL_BUSINESS_READS,name))return APP_LOCAL_BUSINESS_READS[name as keyof typeof APP_LOCAL_BUSINESS_READS].retention==="scoped";
  if(Object.hasOwn(APP_LOCAL_DAILY_READS,name))return APP_LOCAL_DAILY_READS[name as keyof typeof APP_LOCAL_DAILY_READS].retention==="scoped";
  if(Object.hasOwn(APP_LOCAL_SECONDARY_READS,name))return APP_LOCAL_SECONDARY_READS[name as keyof typeof APP_LOCAL_SECONDARY_READS].retention==="scoped";
  if(Object.hasOwn(APP_LOCAL_COMMERCE_READS,name))return APP_LOCAL_COMMERCE_READS[name as keyof typeof APP_LOCAL_COMMERCE_READS].retention==="scoped";
  const explore=APP_LOCAL_EXPLORE_READS.find(rule=>rule.name===name);if(explore)return explore.retain;
  const shell=APP_LOCAL_SHELL_READS.find(rule=>rule.name===name);if(shell)return shell.retain;
  const publicRead=APP_LOCAL_PUBLIC_READS.find(rule=>rule.name===name);if(publicRead)return publicRead.retain;
  return Object.hasOwn(owner.reads,name)&&(owner.reads as Record<string,{cacheable:boolean}>)[name].cacheable;
}
