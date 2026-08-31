import { describe, expect, it } from "vitest";
import { encodeAssetPath } from "./localFileUrl";

describe("encodeAssetPath", () => {
  it("encodes the leading slash but keeps separators as real segments", () => {
    expect(encodeAssetPath("/repo/doc/design.html")).toBe(
      "%2Frepo/doc/design.html",
    );
  });

  it("round-trips to the original path the way the asset handler decodes it", () => {
    const path = "/repo/设计稿 v2/index.html";
    // The handler drops one leading "/" and percent-decodes the remainder.
    const decoded = decodeURIComponent(encodeAssetPath(path));
    expect(decoded).toBe(path);
  });

  it("resolves a sibling reference back to the same directory", () => {
    const base = `asset://localhost/${encodeAssetPath("/repo/doc/design.html")}`;
    const sibling = new URL("./assets/app.css", base);
    expect(decodeURIComponent(sibling.pathname.slice(1))).toBe(
      "/repo/doc/assets/app.css",
    );
  });

  it("escapes characters that would otherwise cut the URL short", () => {
    expect(encodeAssetPath("/repo/a#b?c/d e.html")).toBe(
      "%2Frepo/a%23b%3Fc/d%20e.html",
    );
  });

  it("normalises windows separators and keeps the drive prefix relative", () => {
    expect(encodeAssetPath("C:\\repo\\design.html")).toBe(
      "C%3A/repo/design.html",
    );
  });
});
