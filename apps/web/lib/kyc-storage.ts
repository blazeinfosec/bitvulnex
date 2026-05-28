import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const UPLOADS_DIR = join(process.cwd(), "uploads", "kyc");

export function ensureUploadsDir(): void {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
};

export function mimeForFilename(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
