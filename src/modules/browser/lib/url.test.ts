import { describe, expect, it } from "vitest";
import { assetToPath, displayUrl, localHtmlPath, toUrl } from "./url";

describe("toUrl", () => {
  it("adds https to domains", () => {
    expect(toUrl("baidu.com")).toBe("https://baidu.com");
    expect(toUrl("codeup.aliyun.com/xyz")).toBe(
      "https://codeup.aliyun.com/xyz",
    );
  });
  it("adds http to intranet hosts", () => {
    expect(toUrl("39.100.83.89:40135")).toBe("http://39.100.83.89:40135");
    expect(toUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(toUrl("devbox:8080/app")).toBe("http://devbox:8080/app");
  });
  it("keeps explicit schemes and searches the rest", () => {
    expect(toUrl("https://a.com")).toBe("https://a.com");
    expect(toUrl("http://10.0.0.1")).toBe("http://10.0.0.1");
    expect(toUrl("安卓 投屏")).toContain("bing.com/search?q=");
    expect(toUrl("hello")).toContain("bing.com/search?q=hello");
  });
  it("hides about:blank in the bar", () => {
    expect(displayUrl("about:blank")).toBe("");
    expect(displayUrl("https://a.com")).toBe("https://a.com");
  });
});

describe("localHtmlPath", () => {
  it("accepts absolute, home and file:// html paths", () => {
    expect(localHtmlPath("/a/b/report.html")).toBe("/a/b/report.html");
    expect(localHtmlPath("~/r/index.htm", null, "/Users/me")).toBe(
      "/Users/me/r/index.htm",
    );
    expect(localHtmlPath("file:///a/%E6%8A%A5%E5%91%8A.html")).toBe(
      "/a/报告.html",
    );
    expect(localHtmlPath("/a/page.html#sec")).toBe("/a/page.html");
  });
  it("resolves relative paths against cwd", () => {
    expect(localHtmlPath("build/reports/index.html", "/w/app")).toBe(
      "/w/app/build/reports/index.html",
    );
    expect(localHtmlPath("../x.html", "/w/app")).toBe("/w/x.html");
    expect(localHtmlPath("x.html")).toBeNull();
  });
  it("rejects non-html and urls", () => {
    expect(localHtmlPath("/a/b.md")).toBeNull();
    expect(localHtmlPath("https://a.com/x.html")).toBeNull();
    expect(localHtmlPath("/a/has space.html")).toBeNull();
  });
});

describe("assetToPath", () => {
  it("maps asset urls back to the file path", () => {
    expect(
      assetToPath(
        "asset://localhost/%2FUsers/me/%E6%8A%A5%E5%91%8A%201/index.html",
      ),
    ).toBe("/Users/me/报告 1/index.html");
    expect(assetToPath("https://a.com/")).toBeNull();
  });
});
