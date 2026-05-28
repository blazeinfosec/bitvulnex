import { describe, it, expect } from "vitest";
import { mimeForFilename } from "./kyc-storage";

describe("mimeForFilename", () => {
  it("maps .pdf to application/pdf", () => {
    expect(mimeForFilename("passport.pdf")).toBe("application/pdf");
  });

  it("maps .png and .jpg to their image types", () => {
    expect(mimeForFilename("a.png")).toBe("image/png");
    expect(mimeForFilename("a.jpg")).toBe("image/jpeg");
    expect(mimeForFilename("a.jpeg")).toBe("image/jpeg");
  });

  it("is case-insensitive on the extension", () => {
    expect(mimeForFilename("PASSPORT.PDF")).toBe("application/pdf");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(mimeForFilename("readme")).toBe("application/octet-stream");
    expect(mimeForFilename("data.bin")).toBe("application/octet-stream");
  });
});
