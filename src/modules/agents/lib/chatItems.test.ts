import { describe, expect, it } from "vitest";
import { type ChatItem, chatTurns } from "./chatItems";

describe("chatTurns", () => {
  it("pairs each question with its first answer, markdown stripped", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "这个项目你熟悉么", ts: 1 },
      {
        kind: "tool",
        id: "t1",
        name: "Bash",
        summary: "ls",
        input: {},
        result: null,
        ts: 2,
      },
      {
        kind: "assistant",
        id: "a1",
        text: "目前**还不算**熟悉,`app_x` 是安卓项目",
        ts: 3,
      },
      { kind: "assistant", id: "a2", text: "第二段不算", ts: 4 },
      { kind: "user", id: "u2", text: "", attachments: ["/a/b.png"], ts: 5 },
    ];
    expect(chatTurns(items)).toEqual([
      {
        id: "u1",
        question: "这个项目你熟悉么",
        answer: "目前还不算熟悉,app_x 是安卓项目",
      },
      { id: "u2", question: "附件:b.png", answer: "" },
    ]);
  });

  it("ignores replies before the first question", () => {
    expect(
      chatTurns([{ kind: "assistant", id: "a0", text: "hi", ts: 0 }]),
    ).toEqual([]);
  });
});
