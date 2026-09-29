import { describe, expect, it } from "vitest";
import { displayUrl, toUrl } from "./url";

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
