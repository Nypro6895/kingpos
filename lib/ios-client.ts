// A presentation restriction, never a substitute for server authorization.
export function isReylumiIOSClient(userAgent: string | null) {
  return /(?:^|\s)ReylumiIOS\/\d+(?:\.\d+)*(?:\s|$)/.test(userAgent ?? "");
}

export function isIOSExcludedPath(pathname: string) {
  let path: string;
  try { path = decodeURIComponent(pathname).replace(/\\/g, "/").toLowerCase(); }
  catch { return true; }
  return ["/admin", "/api/admin", "/settings/recovery-back-office", "/api/pos/windows-download"].some(
    prefix => path === prefix || path.startsWith(`${prefix}/`),
  );
}
