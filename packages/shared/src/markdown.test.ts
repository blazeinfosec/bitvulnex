import { describe, it, expect } from "vitest";
import { sanitizeForAdmin, sanitizeForUser } from "./markdown";

describe("sanitizeForAdmin", () => {
  it("strips <script> blocks", () => {
    const md = "Hello\n\n<script>alert(1)</script>\n\nworld";
    const out = sanitizeForAdmin(md);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(1\)/);
  });

  it("strips double-quoted on* handlers", () => {
    const md = `<img src="x" onerror="alert(1)">`;
    const out = sanitizeForAdmin(md);
    expect(out).not.toMatch(/onerror="alert/);
  });
});

describe("sanitizeForUser", () => {
  it("strips all HTML tags", () => {
    const md = `**hello** <img src="x" onerror="alert(1)"> world`;
    const out = sanitizeForUser(md);
    expect(out).not.toMatch(/</);
    expect(out).not.toMatch(/>/);
  });
});
