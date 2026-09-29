import { describe, expect, it } from "vitest";
import {
  annotationCards,
  annotationPrompt,
  describeElement,
} from "./webAnnotations";

const btn = {
  tag: "button",
  text: "提交",
  selector: "form#login > button",
  note: "点了没反应",
};

describe("web annotations", () => {
  it("describes elements with or without text", () => {
    expect(describeElement(btn)).toBe("<button>「提交」");
    expect(describeElement({ ...btn, text: "" })).toBe("<button>");
  });

  it("builds the prompt with page, selector and note", () => {
    const text = annotationPrompt({
      url: "https://a.com/login",
      title: "登录",
      items: [btn, { tag: "div", text: "", selector: "", note: "太挤了" }],
    });
    expect(text).toContain("「登录」(https://a.com/login)");
    expect(text).toContain("2 处批注");
    expect(text).toContain(
      "1. <button>「提交」,选择器 form#login > button:点了没反应",
    );
    expect(text).toContain("2. <div>:太挤了");
  });

  it("falls back to the url when the page has no title", () => {
    expect(
      annotationPrompt({ url: "http://x", title: "", items: [btn] }),
    ).toContain("内嵌浏览器里 http://x 页面上");
  });

  it("makes composer cards", () => {
    expect(annotationCards([btn])).toEqual([
      { thumb: "", note: "<button>「提交」 点了没反应" },
    ]);
  });
});
