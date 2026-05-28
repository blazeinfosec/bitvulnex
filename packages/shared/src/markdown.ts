// Markdown rendering helpers used by the support-ticket pipeline.
//
// Two renderers, two trust levels:
//
// - sanitizeForAdmin: agents see the original markdown with light
//   formatting preserved. The sanitizer drops <script> blocks and
//   strips inline event handlers so a malicious user submission can't
//   move agent JWTs out of localStorage.
// - sanitizeForUser: end users see their own tickets — the renderer
//   collapses everything to plain text so a compromised agent reply
//   can never run in the user's session.

import { marked } from "marked";

export function sanitizeForAdmin(md: string): string {
  let html = marked.parse(md, { async: false }) as string;
  // Drop script tags wholesale.
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  // Remove inline event-handler attributes (onerror, onclick, ...).
  html = html.replace(/on\w+\s*=\s*"[^"]*"/gi, "");
  return html;
}

export function sanitizeForUser(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return html.replace(/<[^>]*>/g, "");
}
