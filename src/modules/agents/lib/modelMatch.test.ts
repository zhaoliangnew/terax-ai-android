import { describe, expect, it } from "vitest";
import { findModel, modelIdName } from "./modelMatch";

const opt = (value: string, displayName: string) => ({
  value,
  displayName,
  description: "",
});
const models = [
  opt("default", "Default (recommended)"),
  opt("opus", "Opus 5.5"),
  opt("claude-fable-5-1", "Fable 5.1"),
  opt("claude-opus-5", "Opus 5"),
];

describe("findModel", () => {
  it("does not mistake Opus 5.5 for Opus 5 by prefix", () => {
    expect(findModel("claude-opus-5-5", models)?.value).toBe("opus");
  });

  it("matches exact ids, aliases and [1m] suffixes", () => {
    expect(findModel("claude-opus-5", models)?.value).toBe("claude-opus-5");
    expect(findModel("opus", models)?.value).toBe("opus");
    expect(findModel("claude-fable-5-1[1m]", models)?.value).toBe(
      "claude-fable-5-1",
    );
  });

  it("finds nothing for an unknown id", () => {
    expect(findModel("claude-haiku-4-5", models)).toBeUndefined();
  });
});

describe("modelIdName", () => {
  it("reads Claude ids", () => {
    expect(modelIdName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelIdName("claude-opus-5")).toBe("Opus 5");
    expect(modelIdName("claude-opus-5-5[1m]")).toBe("Opus 5.5 1M");
    expect(modelIdName("gpt-5.5")).toBe("gpt-5.5");
  });
});
