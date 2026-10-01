import { loginHrefForReturnPath } from "@/lib/auth-routing";

export function buildLoginPath(nextPath: string) {
  return loginHrefForReturnPath(nextPath);
}
