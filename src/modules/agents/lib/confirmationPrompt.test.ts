import { describe, expect, it } from "vitest";
import { asksConfirm } from "@/modules/agents/lib/confirmationPrompt";

describe("confirmation quick replies", () => {
  it("does not treat a progress report as a confirmation request", () => {
    for (const text of [
      "已将规则写入 AGENTS.md。\n\n第二版设计稿已重新打开。\n\nJava 未改：当前仍是待确认设计稿，尚未开始 Android 开发。",
      "本次修改已完成，无需确认。",
      "已发送给张三。",
      "下一步：修复问题后提交。",
      "正在等待确认结果。",
      "检查是否成功。",
      "是否存在其他问题？",
      "你倾向哪个方案？",
      "要不要先修复，还是先 review？",
      "> 要不要我继续？",
      "示例：\n```\n确认吗\n```",
      "说明中写“确认吗？”",
    ])
      expect(asksConfirm(text)).toBe(false);
  });

  it("shows replies for explicit yes/no requests", () => {
    for (const text of [
      "方案已完成。这样可以吗？",
      "确认吗？",
      "要不要我继续实现？",
      "是否按这个方案执行？",
      "你需不需要我发送给张三？",
      "需要我提交吗？",
      "我可以开始修改吗？",
      "**请确认这个方案。**",
      "麻烦你批准这个计划。",
      "要不要我继续",
    ])
      expect(asksConfirm(text)).toBe(true);
  });

  it("only checks the last sentence", () => {
    expect(asksConfirm("确认吗？已完成安装。")).toBe(false);
    expect(asksConfirm("报告中存在待确认事项。\n已完成自测。")).toBe(false);
  });
});
