// Whitelist `next` redirect parameters to same-origin paths only.
// Rejects protocol-relative URLs (//evil), absolute URLs (http://...),
// and anything that doesn't start with a single forward slash.
export function safeNext(next: string | null, fallback = "/account"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/\\")) return fallback;
  return next;
}
